/**
 * Narrow interfaces the extensible pieces depend on, so builtins and wrappers
 * never see the whole `InterpretSession`.
 */

import type { Redirect, Script, Word } from "../syntax/index.ts";
import type { Binding, BindingSource, PendingUse } from "./binding.ts";
import type { VariableState } from "./context.ts";
import type { ScriptDocument } from "./documents.ts";
import type { Scope } from "./environment.ts";
import type { ExpandedValue } from "./expander.ts";
import type { Fragment } from "./values.ts";

export interface SetValueOptions {
    readonly exported?: boolean;
    readonly assignment?: BindingSource;
}

/** The variable/function operations a builtin may perform. */
export interface VariableStore {
    lookup(scope: Scope, name: string): VariableState;
    lookupString(scope: Scope, name: string): string | undefined;
    setString(
        scope: Scope,
        name: string,
        value: string,
        options?: SetValueOptions,
    ): Binding;
    setUnknown(
        scope: Scope,
        name: string,
        options?: { readonly exported?: boolean },
    ): Binding;
    setExpanded(
        scope: Scope,
        name: string,
        fragments: readonly Fragment[],
        options?: SetValueOptions,
    ): Binding;
    markExported(scope: Scope, name: string, exported: boolean): void;
    removeVariable(scope: Scope, name: string): void;
    removeFunction(scope: Scope, name: string): void;
    expandAssignmentWord(word: Word, doc: ScriptDocument, scope: Scope): ExpandedValue;
    /** Enters a function frame so `local`/`declare` are restored on return. */
    enterFunctionFrame(): void;
    leaveFunctionFrame(env: import("./environment.ts").Environment): void;
    /** Marks a name as function-local in the current frame. */
    declareLocal(scope: Scope, name: string): void;
}

/** A heredoc or herestring feeding a command's stdin. */
export interface ShellStdin {
    readonly text: string;
    readonly span: { readonly start: number; readonly end: number };
    readonly redirect: Redirect | undefined;
}

/** stdin for a wrapper: the command's own heredoc, or one inherited from `ssh`. */
export interface StdinSource {
    text(): string | undefined;
    shellStdin(): ShellStdin | undefined;
}

/** What the word expander needs from the interpreter. */
export interface ExpansionHost {
    assignBinding(scope: Scope, name: string, fragments: readonly Fragment[]): void;
}

/** A script embedded in another word (`$(…)`, `<(…)`) to run in a fork. */
export interface EmbeddedScript {
    readonly script: Script;
    readonly doc: ScriptDocument;
}

export type { PendingUse };
