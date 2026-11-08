/**
 * One command as it will be executed, after wrappers have been peeled. The
 * interpreter emits an `Invocation` for every simple command it can see,
 * including commands inside `$(…)`, functions, loops and branches.
 */

import type { SimpleCommand } from "../syntax/index.ts";
import type { Binding } from "./binding.ts";
import type { EnvironmentView, ExecutionContext } from "./context.ts";
import type { ScriptDocument } from "./documents.ts";
import type { Arg } from "./values.ts";

/** A wrapper peeled before the effective command, and where it sat. */
export interface WrapperRef {
    readonly name: string;
    /** Index of the wrapper's command word in the original `fullArgv`. */
    readonly offset: number;
}

/** One redirection as it will actually run, expanded for the validator. */
export interface InvocationRedirect {
    /** `"1"`, `"2"`, `"{fd}"`, or `""` for the operator's default. */
    readonly fd: string;
    readonly operator: string;
    /** The expanded target, or `undefined` for a heredoc / unknown. */
    readonly target: string | undefined;
    /** The expanded heredoc body, or `undefined` for other redirects. */
    readonly heredoc: string | undefined;
}

export interface Invocation {
    readonly kind: "external" | "builtin" | "function";
    /** The AST node as written. */
    readonly command: SimpleCommand;
    readonly doc: ScriptDocument;
    /** All arguments as written, before wrapper peeling. */
    readonly fullArgv: readonly Arg[];
    /** Where the effective command starts in `fullArgv`. */
    readonly offset: number;
    /** `fullArgv.slice(offset)`. */
    readonly argv: readonly Arg[];
    readonly wrappers: readonly WrapperRef[];
    /** Prefix assignments, as expanded bindings. */
    readonly assignments: readonly Binding[];
    /** What the command sees; equal to `context.env`. */
    readonly env: EnvironmentView;
    readonly context: ExecutionContext;
    /** Every redirection of the command, expanded, for validation. */
    readonly redirects: readonly InvocationRedirect[];
    /**
     * The command's statically known stdin text: a quoted heredoc, or an
     * unquoted one (or herestring) whose expansion is fully known. `undefined`
     * when stdin comes from a pipe, a file, or an expansion we cannot resolve.
     */
    readonly stdin: string | undefined;
    /**
     * True when the invocation comes from a function body that is only visited
     * speculatively (a function that is never called).
     */
    readonly speculative: boolean;
}
