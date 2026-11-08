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
    /**
     * True when the invocation comes from a function body that is only visited
     * speculatively (a function that is never called).
     */
    readonly speculative: boolean;
}
