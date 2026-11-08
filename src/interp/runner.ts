// Simple-command expansion and dispatch are inherently branchy.
/* eslint-disable sonarjs/function-return-type */
/**
 * Simple commands: prefix assignments, word expansion, wrapper peeling, and
 * dispatch to a function / builtin / external command, plus invocation emission.
 * The AST walk (lists, chains, compounds) lives in `CommandWalker`.
 */

import type { Assignment, FunctionDefinition, SimpleCommand } from "../syntax/index.ts";
import type { Binding, PendingUse } from "./binding.ts";
import type { BuiltinInput } from "./builtins/types.ts";
import type { ScriptDocument } from "./documents.ts";
import { stringValues } from "./documents.ts";
import { type Environment, type Scope, type VariableEntry } from "./environment.ts";
import type { WordExpander } from "./expander.ts";
import type { ShellStdin, StdinSource } from "./interfaces.ts";
import type { Invocation, WrapperRef } from "./invocation.ts";
import type { InterpretSession } from "./session.ts";
import type { Arg } from "./values.ts";
import type { CommandWalker } from "./walker.ts";
import type { EffectiveCommand, Unwrapped, Wrapper } from "./wrappers/types.ts";

interface PeeledCommand {
    readonly offset: number;
    readonly end: number | undefined;
    readonly wrappers: readonly WrapperRef[];
    readonly scope: Scope;
    readonly execStyle: boolean;
}

interface PeeledScript {
    readonly offset: number;
    readonly wrappers: readonly WrapperRef[];
    readonly script: Unwrapped & { readonly kind: "script" };
}

type PeelResult =
    | { readonly kind: "commands"; readonly commands: readonly PeeledCommand[] }
    | { readonly kind: "script"; readonly peeled: PeeledScript };

/** Everything a peeled simple command needs, built once. */
interface ExpandedCommand {
    readonly ast: SimpleCommand;
    readonly doc: ScriptDocument;
    readonly fullArgv: readonly Arg[];
    readonly pending: readonly PendingUse[];
    readonly assignments: readonly Binding[];
    readonly prefixNames: readonly string[];
    readonly commandEnvScope: Scope;
    readonly baseScope: Scope;
}

export class CommandRunner {
    private functionDepth = 0;

    constructor(
        private readonly session: InterpretSession,
        private readonly expander: WordExpander,
        private readonly walker: CommandWalker,
    ) {}

    runSimpleCommand(command: SimpleCommand, doc: ScriptDocument, scope: Scope): void {
        const ownStdin = this.walker.expandRedirects(command.redirects, doc, scope);

        if (command.words.length === 0) {
            this.persistAssignments(command, doc, scope);
            return;
        }

        const commandEnv =
            command.assignments.length > 0 ? scope.env.fork() : scope.env;
        const commandEnvScope: Scope = { host: scope.host, env: commandEnv };
        const prefixBindings: Binding[] = [];
        for (const assignment of command.assignments) {
            prefixBindings.push(this.applyAssignment(assignment, doc, commandEnvScope));
        }

        const fullArgv: Arg[] = [];
        const pending: PendingUse[] = [];
        for (const word of command.words) {
            const expansion = this.expander.expandWord(word, doc, commandEnvScope);
            const base = fullArgv.length;
            for (const arg of expansion.args) {
                fullArgv.push(arg);
            }
            for (const use of expansion.uses) {
                pending.push({
                    ...use,
                    indexes: use.indexes.map((index) => index + base),
                });
            }
            this.walker.runEmbeddedJobs(expansion.embedded, commandEnvScope);
        }
        if (fullArgv.length === 0) {
            this.persistAssignments(command, doc, scope);
            return;
        }

        const expanded: ExpandedCommand = {
            ast: command,
            doc,
            fullArgv,
            pending,
            assignments: prefixBindings,
            prefixNames: prefixBindings.map((binding) => binding.name),
            commandEnvScope,
            baseScope: scope,
        };

        // Functions take precedence over builtins and wrappers.
        const firstName = fullArgv[0]?.value;
        const fn =
            firstName === undefined
                ? undefined
                : commandEnvScope.env.functions.get(firstName);
        if (fn !== undefined) {
            const peeled: PeeledCommand = {
                offset: 0,
                end: undefined,
                wrappers: [],
                scope: commandEnvScope,
                execStyle: false,
            };
            this.emit("function", expanded, peeled);
            this.runFunction(fn, expanded, peeled);
            return;
        }

        const peelResult = this.peel(fullArgv, commandEnvScope, ownStdin);
        if (peelResult.kind === "script") {
            const { offset, wrappers, script } = peelResult.peeled;
            const invocation = this.emitScript(expanded, offset, wrappers, script);
            this.walker.runScriptSource(
                script.source,
                invocation,
                script.scope,
                script.stdinText,
            );
            return;
        }
        for (const peeled of peelResult.commands) {
            this.dispatch(expanded, peeled);
        }
    }

    private persistAssignments(
        command: SimpleCommand,
        doc: ScriptDocument,
        scope: Scope,
    ): void {
        for (const assignment of command.assignments) {
            this.applyAssignment(assignment, doc, scope);
        }
    }

    private applyAssignment(
        assignment: Assignment,
        doc: ScriptDocument,
        scope: Scope,
    ): Binding {
        const exported = scope.env.entry(assignment.name)?.exported ?? false;
        if (assignment.value.kind === "ArrayValue") {
            for (const element of assignment.value.elements) {
                const expanded = this.expander.expandValue(element, doc, scope);
                this.session.recordUses(expanded.uses, { kind: "assignment" });
                this.walker.runEmbeddedJobs(expanded.embedded, scope);
            }
            return this.session.setUnknown(scope, assignment.name, { exported });
        }
        if (assignment.index !== undefined) {
            return this.session.setUnknown(scope, assignment.name, { exported });
        }
        const expanded = this.expander.expandAssignmentValue(
            assignment.value,
            doc,
            scope,
        );
        this.session.recordUses(expanded.uses, { kind: "assignment" });
        this.walker.runEmbeddedJobs(expanded.embedded, scope);
        let fragments = expanded.fragments;
        if (assignment.append) {
            const previous = scope.env.entry(assignment.name);
            if (previous?.state.kind === "unknown") {
                return this.session.setUnknown(scope, assignment.name, { exported });
            }
            fragments = [...(previous?.binding?.value ?? []), ...fragments];
        }
        return this.session.setExpanded(scope, assignment.name, fragments, {
            exported,
            assignment,
        });
    }

    // --- wrapper peeling ----------------------------------------------------

    private peel(
        fullArgv: readonly Arg[],
        scope: Scope,
        ownStdin: ShellStdin | undefined,
    ): PeelResult {
        const stdin = this.walker.makeStdin(ownStdin);
        let index = 0;
        let currentScope = scope;
        const applied: WrapperRef[] = [];
        let execStyle = false;
        for (let depth = 0; depth <= this.session.limits.maxWrappers; depth += 1) {
            const remainder = fullArgv.slice(index);
            if (remainder.length === 0) {
                break;
            }
            const found = this.findUnwrap(remainder, currentScope, stdin);
            if (found === undefined) {
                break;
            }
            const items = asArray(found.result);
            const scripts = items.filter(isScript);
            const commands = items.filter(isCommand);
            if (scripts.length === 1 && commands.length === 0) {
                const script = scripts[0] as Unwrapped & { readonly kind: "script" };
                return {
                    kind: "script",
                    peeled: { offset: index, wrappers: applied, script },
                };
            }
            const only = commands.length === 1 ? commands[0] : undefined;
            if (only !== undefined && only.end === undefined) {
                applied.push({ name: found.wrapper.name, offset: index });
                execStyle ||= found.wrapper.execStyle === true;
                index += only.offset;
                currentScope = only.scope;
                continue;
            }
            const ref: WrapperRef = { name: found.wrapper.name, offset: index };
            const wrapperExec = found.wrapper.execStyle === true;
            return {
                kind: "commands",
                commands: commands.map((command) => ({
                    offset: index + command.offset,
                    end: command.end === undefined ? undefined : index + command.end,
                    wrappers: [...applied, ref],
                    scope: command.scope,
                    execStyle: execStyle || wrapperExec,
                })),
            };
        }
        return {
            kind: "commands",
            commands: [
                {
                    offset: index,
                    end: undefined,
                    wrappers: applied,
                    scope: currentScope,
                    execStyle,
                },
            ],
        };
    }

    private findUnwrap(
        remainder: readonly Arg[],
        scope: Scope,
        stdin: StdinSource,
    ):
        | {
              readonly wrapper: Wrapper;
              readonly result: Unwrapped | readonly Unwrapped[];
          }
        | undefined {
        for (const wrapper of this.session.wrappers.all()) {
            const result = wrapper.unwrap({ argv: remainder, scope, stdin });
            if (result !== undefined) {
                return { wrapper, result };
            }
        }
        return undefined;
    }

    // --- dispatch -----------------------------------------------------------

    private dispatch(expanded: ExpandedCommand, peeled: PeeledCommand): void {
        const argv = sliceArgv(expanded.fullArgv, peeled.offset, peeled.end);
        if (argv.length === 0) {
            return;
        }
        const name = argv[0]?.value;
        const builtin =
            name === undefined ? undefined : this.session.builtins.lookup(name);
        if (name !== undefined && builtin !== undefined) {
            this.emit("builtin", expanded, peeled);
            this.runEffect(peeled, expanded, (effectScope) => {
                const input: BuiltinInput = {
                    name,
                    argv,
                    doc: expanded.doc,
                    scope: effectScope,
                    store: this.session,
                };
                builtin.apply(input);
            });
            return;
        }
        this.emit("external", expanded, peeled);
    }

    private runFunction(
        fn: FunctionDefinition,
        expanded: ExpandedCommand,
        peeled: PeeledCommand,
    ): void {
        if (this.functionDepth >= this.session.limits.maxFunctionDepth) {
            this.session.markTruncated();
            return;
        }
        this.session.markCalled(fn.name);
        this.runEffect(peeled, expanded, (effectScope) => {
            const savedPositionals = effectScope.env.positionals;
            effectScope.env.positionals = stringValues(
                sliceArgv(expanded.fullArgv, peeled.offset, peeled.end).slice(1),
            );
            this.session.enterFunctionFrame();
            this.functionDepth += 1;
            try {
                this.walker.runCommand(fn.body, expanded.doc, effectScope);
            } finally {
                this.functionDepth -= 1;
                this.session.leaveFunctionFrame(effectScope.env);
                effectScope.env.positionals = savedPositionals;
            }
        });
    }

    /**
     * Runs a builtin's or function's effect. A wrapper that starts a separate
     * process (`timeout`, `nice`, `xargs`, `find`…) cannot change the shell
     * state, so the effect lands on a throwaway fork; otherwise it lands on the
     * shell that interpreted the command.
     */
    private runEffect(
        peeled: PeeledCommand,
        expanded: ExpandedCommand,
        effect: (scope: Scope) => void,
    ): void {
        let target: Environment;
        if (peeled.execStyle) {
            target = peeled.scope.env.fork();
        } else if (peeled.scope.env === expanded.commandEnvScope.env) {
            target = expanded.baseScope.env;
        } else {
            target = peeled.scope.env;
        }
        const saved = applyPrefix(
            target,
            expanded.commandEnvScope.env,
            expanded.prefixNames,
        );
        try {
            effect({ host: peeled.scope.host, env: target });
        } finally {
            restorePrefix(target, saved);
        }
    }

    // --- emission -----------------------------------------------------------

    private emit(
        kind: Invocation["kind"],
        expanded: ExpandedCommand,
        peeled: PeeledCommand,
    ): Invocation {
        const context = this.session.context(peeled.scope);
        const invocation: Invocation = {
            kind,
            command: expanded.ast,
            doc: expanded.doc,
            fullArgv: expanded.fullArgv,
            offset: peeled.offset,
            argv: sliceArgv(expanded.fullArgv, peeled.offset, peeled.end),
            wrappers: peeled.wrappers,
            assignments: expanded.assignments,
            env: context.env,
            context,
            speculative: this.session.isSpeculative,
        };
        this.session.record(invocation, expanded.pending);
        return invocation;
    }

    private emitScript(
        expanded: ExpandedCommand,
        offset: number,
        wrappers: readonly WrapperRef[],
        script: PeeledScript["script"],
    ): Invocation {
        const context = this.session.context(expanded.commandEnvScope);
        const invocation: Invocation = {
            kind: script.invocationKind,
            command: expanded.ast,
            doc: expanded.doc,
            fullArgv: expanded.fullArgv,
            offset,
            argv: expanded.fullArgv.slice(offset),
            wrappers,
            assignments: expanded.assignments,
            env: context.env,
            context,
            speculative: this.session.isSpeculative,
        };
        this.session.record(invocation, expanded.pending);
        return invocation;
    }
}

function sliceArgv(
    fullArgv: readonly Arg[],
    offset: number,
    end: number | undefined,
): readonly Arg[] {
    return end === undefined ? fullArgv.slice(offset) : fullArgv.slice(offset, end);
}

function isScript(item: Unwrapped): item is Unwrapped & { readonly kind: "script" } {
    return item.kind === "script";
}

function isCommand(item: Unwrapped): item is EffectiveCommand {
    return item.kind === "command";
}

function asArray(value: Unwrapped | readonly Unwrapped[]): readonly Unwrapped[] {
    return Array.isArray(value)
        ? (value as readonly Unwrapped[])
        : [value as Unwrapped];
}

function applyPrefix(
    target: Environment,
    source: Environment,
    names: readonly string[],
): Map<string, VariableEntry | undefined> {
    const saved = new Map<string, VariableEntry | undefined>();
    for (const name of names) {
        saved.set(name, target.entry(name));
        const entry = source.entry(name);
        if (entry !== undefined) {
            target.put(name, entry);
        }
    }
    return saved;
}

function restorePrefix(
    target: Environment,
    saved: Map<string, VariableEntry | undefined>,
): void {
    for (const [name, entry] of saved) {
        if (entry === undefined) {
            target.unset(name);
        } else {
            target.put(name, entry);
        }
    }
}
