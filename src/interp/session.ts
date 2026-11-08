/**
 * Per-interpretation mutable state. An `InterpretSession` is created for every
 * `Interpreter.interpret` call, so the `Interpreter` stays stateless.
 *
 * The session owns the invocation/binding/use/document lists, the limits, the
 * variable store (used by builtins), the function frames (`local`/`declare`
 * restore them on return) and the `$(…)` nesting counter. The AST walk itself
 * lives in `CommandWalker`/`CommandRunner`; they are attached after
 * construction to avoid a construction cycle.
 */

import { normalizeAbsolute } from "../shared/posix-path.ts";
import type { Node, Word } from "../syntax/index.ts";
import type {
    Binding,
    BindingSource,
    BindingUse,
    PendingUse,
    UseSite,
} from "./binding.ts";
import type { BuiltinRegistry } from "./builtins/registry.ts";
import type { VariableState } from "./context.ts";
import { LOCAL_HOST } from "./context.ts";
import type { ScriptDocument } from "./documents.ts";
import {
    Environment,
    executionContext,
    type Scope,
    type VariableEntry,
} from "./environment.ts";
import type { WordExpander } from "./expander.ts";
import type { ExpansionHost, SetValueOptions, VariableStore } from "./interfaces.ts";
import type { Invocation } from "./invocation.ts";
import { type Fragment, fragmentsValue, type Origin } from "./values.ts";
import type { WrapperRegistry } from "./wrappers/registry.ts";

export interface InterpreterLimits {
    readonly maxNestingDepth: number;
    readonly maxFunctionDepth: number;
    readonly maxInvocations: number;
    readonly maxWrappers: number;
}

export const DEFAULT_LIMITS: InterpreterLimits = {
    maxNestingDepth: 16,
    maxFunctionDepth: 16,
    maxInvocations: 2000,
    maxWrappers: 16,
};

export interface InitialState {
    readonly cwd: string | undefined;
    readonly variables: Readonly<Record<string, string>>;
    /**
     * `true`: names absent from `variables` are "unset"; `false`: "unknown".
     */
    readonly complete: boolean;
}

export interface SessionDependencies {
    readonly wrappers: WrapperRegistry;
    readonly builtins: BuiltinRegistry;
    readonly limits: InterpreterLimits;
}

/** Internal runner contract, implemented by `CommandWalker`. */
export interface EmbeddedRunner {
    runEmbedded(
        script: import("../syntax/index.ts").Script,
        doc: ScriptDocument,
        scope: Scope,
    ): void;
}

/**
 * Origin of values the interpreter sets itself (builtin results such as
 * `VIRTUAL_ENV`, `set`, `read`): a dedicated frozen `computed` origin, so it is
 * never confused with a real source node.
 */
const SYNTHETIC_NODE: Node = Object.freeze({
    kind: "Word",
    parts: Object.freeze([]),
    value: "",
    span: Object.freeze({ start: 0, end: 0 }),
});
const SYNTHETIC_ORIGIN: Origin = Object.freeze({
    kind: "computed",
    node: SYNTHETIC_NODE,
});

function makeBinding(
    name: string,
    value: readonly Fragment[],
    assignment: BindingSource | undefined,
    doc: ScriptDocument | undefined,
    exported: boolean,
): Binding {
    return { name, value, assignment, doc, exported };
}

export class InterpretSession implements VariableStore, ExpansionHost {
    readonly wrappers: WrapperRegistry;
    readonly builtins: BuiltinRegistry;
    readonly limits: InterpreterLimits;

    readonly invocations: Invocation[] = [];
    readonly bindings: Binding[] = [];
    readonly uses = new Map<Binding, BindingUse[]>();
    readonly documents: ScriptDocument[] = [];
    truncated = false;

    private speculative = false;
    private nestingDepth = 0;
    private readonly calledFunctions = new Set<string>();
    private readonly frames: Array<Map<string, VariableEntry | undefined>> = [];
    private expander: WordExpander | undefined;
    private walker: EmbeddedRunner | undefined;

    constructor(dependencies: SessionDependencies) {
        this.wrappers = dependencies.wrappers;
        this.builtins = dependencies.builtins;
        this.limits = dependencies.limits;
    }

    /** Wires the collaborators that cannot be built before the session. */
    attach(expander: WordExpander, walker: EmbeddedRunner): void {
        this.expander = expander;
        this.walker = walker;
    }

    // --- entry point --------------------------------------------------------

    initialScope(initial: InitialState): Scope {
        const env = Environment.empty(initial.complete);
        env.cwd =
            initial.cwd === undefined ? undefined : normalizeAbsolute(initial.cwd);
        for (const [name, value] of Object.entries(initial.variables)) {
            const binding = makeBinding(name, [], undefined, undefined, true);
            this.bindings.push(binding);
            env.put(name, { state: { kind: "set", value }, binding, exported: true });
        }
        return { host: LOCAL_HOST, env };
    }

    // --- run state used by the walker ---------------------------------------

    get isSpeculative(): boolean {
        return this.speculative;
    }

    setSpeculative(value: boolean): void {
        this.speculative = value;
    }

    markCalled(name: string): void {
        this.calledFunctions.add(name);
    }

    wasCalled(name: string): boolean {
        return this.calledFunctions.has(name);
    }

    markTruncated(): void {
        this.truncated = true;
    }

    pushDocument(doc: ScriptDocument): void {
        this.documents.push(doc);
    }

    enterNesting(): boolean {
        if (this.nestingDepth >= this.limits.maxNestingDepth) {
            this.truncated = true;
            return false;
        }
        this.nestingDepth += 1;
        return true;
    }

    leaveNesting(): void {
        this.nestingDepth -= 1;
    }

    /** Runs a `$(…)`/`<(…)` script in a discarded fork of `scope`. */
    runEmbedded(
        script: import("../syntax/index.ts").Script,
        doc: ScriptDocument,
        scope: Scope,
    ): void {
        this.walker?.runEmbedded(script, doc, scope);
    }

    // --- VariableStore (builtins) -------------------------------------------

    lookup(scope: Scope, name: string): VariableState {
        return scope.env.lookup(name);
    }

    lookupString(scope: Scope, name: string): string | undefined {
        const state = scope.env.lookup(name);
        return state.kind === "set" ? state.value : undefined;
    }

    setString(
        scope: Scope,
        name: string,
        value: string,
        options: SetValueOptions = {},
    ): Binding {
        return this.setFragments(
            scope,
            name,
            [{ text: value, origin: SYNTHETIC_ORIGIN }],
            options,
        );
    }

    setUnknown(
        scope: Scope,
        name: string,
        options: { readonly exported?: boolean } = {},
    ): Binding {
        const exported = options.exported ?? this.isExported(scope, name);
        const binding = makeBinding(name, [], undefined, undefined, exported);
        this.bindings.push(binding);
        scope.env.put(name, { state: { kind: "unknown" }, binding, exported });
        return binding;
    }

    setExpanded(
        scope: Scope,
        name: string,
        fragments: readonly Fragment[],
        options: SetValueOptions = {},
    ): Binding {
        return this.setFragments(scope, name, fragments, options);
    }

    markExported(scope: Scope, name: string, exported: boolean): void {
        const existing = scope.env.entry(name);
        const state: VariableState = existing?.state ?? { kind: "unset" };
        const binding = makeBinding(
            name,
            existing?.binding?.value ?? [],
            existing?.binding?.assignment,
            existing?.binding?.doc,
            exported,
        );
        this.bindings.push(binding);
        scope.env.put(name, { state, binding, exported });
    }

    removeVariable(scope: Scope, name: string): void {
        scope.env.unset(name);
    }

    removeFunction(scope: Scope, name: string): void {
        scope.env.functions.delete(name);
    }

    recordRead(scope: Scope, name: string, node: Node, doc: ScriptDocument): void {
        const binding = scope.env.entry(name)?.binding;
        if (binding !== undefined) {
            this.recordUses([{ binding, part: node, doc, indexes: [] }], {
                kind: "other",
            });
        }
    }

    expandAssignmentWord(
        word: Word,
        doc: ScriptDocument,
        scope: Scope,
    ): import("./expander.ts").ExpandedValue {
        if (this.expander === undefined) {
            return { fragments: [], value: undefined, uses: [], embedded: [] };
        }
        const expanded = this.expander.expandAssignmentValue(word, doc, scope);
        this.recordUses(expanded.uses, { kind: "assignment" });
        for (const job of expanded.embedded) {
            this.runEmbedded(job.script, job.doc, scope);
        }
        return expanded;
    }

    enterFunctionFrame(): void {
        this.frames.push(new Map());
    }

    leaveFunctionFrame(env: Environment): void {
        const frame = this.frames.pop();
        if (frame === undefined) {
            return;
        }
        for (const [name, entry] of frame) {
            if (entry === undefined) {
                env.unset(name);
            } else {
                env.put(name, entry);
            }
        }
    }

    declareLocal(scope: Scope, name: string): void {
        const frame = this.frames[this.frames.length - 1];
        if (frame === undefined || frame.has(name)) {
            return;
        }
        frame.set(name, scope.env.entry(name));
    }

    // --- ExpansionHost ------------------------------------------------------

    assignBinding(scope: Scope, name: string, fragments: readonly Fragment[]): void {
        this.setFragments(scope, name, fragments, {});
    }

    // --- emission -----------------------------------------------------------

    recordUses(uses: readonly PendingUse[], site: UseSite): void {
        for (const use of uses) {
            const entry: BindingUse = {
                binding: use.binding,
                part: use.part,
                doc: use.doc,
                site,
            };
            const list = this.uses.get(use.binding);
            if (list === undefined) {
                this.uses.set(use.binding, [entry]);
            } else {
                list.push(entry);
            }
        }
    }

    record(invocation: Invocation, pending: readonly PendingUse[]): void {
        if (this.invocations.length >= this.limits.maxInvocations) {
            this.truncated = true;
            return;
        }
        this.invocations.push(invocation);
        for (const use of pending) {
            this.recordUses([use], {
                kind: "argv",
                invocation,
                argIndexes: use.indexes,
            });
        }
    }

    context(scope: Scope) {
        return executionContext(scope);
    }

    // --- helpers ------------------------------------------------------------

    private setFragments(
        scope: Scope,
        name: string,
        fragments: readonly Fragment[],
        options: SetValueOptions,
    ): Binding {
        const exported = options.exported ?? this.isExported(scope, name);
        const binding = makeBinding(
            name,
            fragments,
            options.assignment,
            options.doc,
            exported,
        );
        this.bindings.push(binding);
        const value = fragmentsValue(fragments);
        scope.env.put(name, {
            state: value === undefined ? { kind: "unknown" } : { kind: "set", value },
            binding,
            exported,
        });
        return binding;
    }

    private isExported(scope: Scope, name: string): boolean {
        return scope.env.entry(name)?.exported ?? false;
    }
}
