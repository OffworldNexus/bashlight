/**
 * The wrapper extension point. A wrapper recognizes a command that runs another
 * command and describes how: as an argv suffix (`sudo`, `timeout`, `env`, …) or
 * as a whole script (`bash -c`, `ssh host '…'`, `eval`, heredoc-to-shell).
 *
 * Wrappers are conservative: when they meet an option (or option value) they do
 * not understand, they return `undefined` and the command is left alone.
 */

import type { ScriptSource } from "../documents.ts";
import type { Scope } from "../environment.ts";
import type { StdinSource } from "../interfaces.ts";
import type { Arg } from "../values.ts";

export interface UnwrapInput {
    /** The remaining argv, starting at the wrapper's own command word. */
    readonly argv: readonly Arg[];
    readonly scope: Scope;
    /** The command's own stdin heredoc, or one inherited from `ssh`. */
    readonly stdin: StdinSource;
}

export interface EffectiveCommand {
    readonly kind: "command";
    /** Where the effective command starts, relative to `argv`. */
    readonly offset: number;
    /** Where it ends, relative to `argv` (for `find -exec`, bounded). */
    readonly end: number | undefined;
    /** Where the effective command runs. */
    readonly scope: Scope;
}

export interface EffectiveScript {
    readonly kind: "script";
    readonly source: ScriptSource;
    /** Where the nested script runs (a child shell, a remote host…). */
    readonly scope: Scope;
    readonly invocationKind: "external" | "builtin";
    /** A heredoc/stdin consumed by the nested command (`ssh host bash -s`). */
    readonly stdinText?: string;
}

export type Unwrapped = EffectiveCommand | EffectiveScript;

export interface Wrapper {
    readonly name: string;
    /**
     * True when the wrapper runs the inner command in a separate process, so a
     * builtin under it cannot change the shell state.
     */
    readonly execStyle?: boolean;
    unwrap(input: UnwrapInput): Unwrapped | readonly Unwrapped[] | undefined;
}
