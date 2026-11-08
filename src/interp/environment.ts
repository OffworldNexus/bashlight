/* eslint-disable sonarjs/function-return-type */
/**
 * The shell state the interpreter walks with: variables, the working
 * directory, the directory stack, positional parameters, functions and sourced
 * files.
 *
 * The environment is **mutable with forks**: `fork()` deep-copies the visible
 * state (bindings are immutable and shared), a subshell/pipeline member/`$(…)`
 * runs against a fork that is then discarded, and branches are joined again
 * with `mergeFrom` (a variable that differs across branches becomes unknown, a
 * cwd that differs becomes undefined). `Scope` pairs the environment with the
 * host it runs on, so a remote context is just an environment on another host.
 */

import type { FunctionDefinition } from "../syntax/index.ts";
import type { Binding } from "./binding.ts";
import type {
    EnvironmentView,
    ExecutionContext,
    Host,
    VariableState,
} from "./context.ts";

/** Where a command runs: the host plus the mutable shell state. */
export interface Scope {
    readonly host: Host;
    readonly env: Environment;
}

export interface VariableEntry {
    readonly state: VariableState;
    readonly binding: Binding | undefined;
    readonly exported: boolean;
}

export function executionContext(scope: Scope): ExecutionContext {
    return { cwd: scope.env.cwd, host: scope.host, env: scope.env.view() };
}

class VariablesView implements EnvironmentView {
    constructor(private readonly environment: Environment) {}

    lookup(name: string): VariableState {
        return this.environment.lookup(name);
    }
}

/** Reads a variable as a string; `undefined` when unset or unknown. */
export function readString(view: EnvironmentView, name: string): string | undefined {
    const state = view.lookup(name);
    return state.kind === "set" ? state.value : undefined;
}

export class Environment {
    readonly variables: Map<string, VariableEntry> = new Map();
    cwd: string | undefined;
    oldPwd: string | undefined;
    readonly dirStack: string[] = [];
    /** Positional parameters (`$1`…); `undefined` when unknown. */
    positionals: readonly string[] | undefined;
    /** `$0`. */
    shellName: string | undefined;
    readonly functions: Map<string, FunctionDefinition> = new Map();
    readonly sourced: string[] = [];
    /** When true, a name that is absent is "unset"; otherwise "unknown". */
    readonly complete: boolean;
    /** The PATH value before the last `activate` (for `deactivate`). */
    pathBeforeActivate: string | undefined;

    constructor(complete: boolean) {
        this.complete = complete;
    }

    static empty(complete: boolean): Environment {
        return new Environment(complete);
    }

    fork(): Environment {
        const copy = new Environment(this.complete);
        this.copyInto(copy, false);
        return copy;
    }

    /** A child shell's environment: only the exported variables are visible. */
    exportedFork(): Environment {
        const copy = new Environment(this.complete);
        this.copyInto(copy, true);
        return copy;
    }

    private copyInto(target: Environment, exportedOnly: boolean): void {
        for (const [name, entry] of this.variables) {
            if (!exportedOnly || entry.exported) {
                target.variables.set(name, entry);
            }
        }
        target.cwd = this.cwd;
        target.oldPwd = this.oldPwd;
        target.dirStack.push(...this.dirStack);
        target.positionals = this.positionals;
        target.shellName = this.shellName;
        target.pathBeforeActivate = this.pathBeforeActivate;
        for (const [name, fn] of this.functions) {
            target.functions.set(name, fn);
        }
        target.sourced.push(...this.sourced);
    }

    /** Marks a name explicitly unset, even in an incomplete environment. */
    unset(name: string): void {
        this.variables.set(name, {
            state: { kind: "unset" },
            binding: undefined,
            exported: false,
        });
    }

    lookup(name: string): VariableState {
        const entry = this.variables.get(name);
        if (entry !== undefined) {
            return entry.state;
        }
        return this.complete ? { kind: "unset" } : { kind: "unknown" };
    }

    entry(name: string): VariableEntry | undefined {
        return this.variables.get(name);
    }

    put(name: string, entry: VariableEntry): void {
        this.variables.set(name, entry);
    }

    remove(name: string): void {
        this.variables.delete(name);
    }

    view(): EnvironmentView {
        return new VariablesView(this);
    }

    /**
     * Merges sibling branches (e.g. the arms of an `if`) back into this
     * environment: a variable that is not identical in every branch becomes
     * unknown, a cwd that differs becomes undefined.
     */
    mergeFrom(branches: readonly Environment[]): void {
        const first = branches[0];
        if (first === undefined) {
            return;
        }
        const names = new Set<string>(this.variables.keys());
        for (const branch of branches) {
            for (const name of branch.variables.keys()) {
                names.add(name);
            }
        }
        for (const name of names) {
            const entries = branches.map((branch) => branch.variables.get(name));
            const defined = entries.filter(
                (entry): entry is VariableEntry => entry !== undefined,
            );
            if (defined.length === 0) {
                this.variables.delete(name);
                continue;
            }
            if (agrees(entries)) {
                this.variables.set(name, defined[0] as VariableEntry);
                continue;
            }
            this.variables.set(name, {
                state: { kind: "unknown" },
                binding: defined[0]?.binding,
                exported: defined.some((entry) => entry.exported),
            });
        }
        this.cwd = allEqual(branches.map((branch) => branch.cwd))
            ? first.cwd
            : undefined;
        this.oldPwd = allEqual(branches.map((branch) => branch.oldPwd))
            ? first.oldPwd
            : undefined;
        this.positionals = allEqual(
            branches.map((branch) => branch.positionals?.join("\u0000")),
        )
            ? first.positionals
            : undefined;
        for (const branch of branches) {
            for (const [name, fn] of branch.functions) {
                this.functions.set(name, fn);
            }
        }
    }
}

function agrees(entries: readonly (VariableEntry | undefined)[]): boolean {
    const first = entries[0];
    if (first === undefined) {
        return entries.every((entry) => entry === undefined);
    }
    return entries.every(
        (entry) =>
            entry !== undefined &&
            entry.exported === first.exported &&
            sameState(entry.state, first.state),
    );
}

function sameState(a: VariableState, b: VariableState): boolean {
    if (a.kind !== b.kind) {
        return false;
    }
    if (a.kind === "set" && b.kind === "set") {
        return a.value === b.value;
    }
    return true;
}

function allEqual<T>(values: readonly T[]): boolean {
    return values.every((value) => value === values[0]);
}

/** A subshell / pipeline member / `$(…)` scope: a discarded fork. */
export function forkScope(scope: Scope): Scope {
    return { host: scope.host, env: scope.env.fork() };
}

/** A child shell's scope: same host and cwd, only the exported variables. */
export function childScope(scope: Scope): Scope {
    return { host: scope.host, env: scope.env.exportedFork() };
}
