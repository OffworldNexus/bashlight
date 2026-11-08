/**
 * Recognition of an OpenCode tool event that runs a shell command.
 *
 * Everything here is pure: it validates the `unknown` event shape with type
 * guards, recognizes the shell tool (v2 name `shell`, legacy `bash`), and
 * resolves the effective working directory against the session directory. A
 * validated call exposes a `replaceCommand` closure: the event's `input` is a
 * live object, and writing into it is the one deliberate mutation.
 */

import { isRecord } from "../shared/guards.ts";
import { resolve } from "../shared/posix-path.ts";

/** OpenCode's shell tool names: v2 `shell`, legacy `bash`. */
const SHELL_TOOLS: readonly string[] = Object.freeze(["shell", "bash"]);

/** A validated shell tool call. */
export interface ShellCall {
    readonly sessionID: string;
    readonly callID: string;
    /** The command exactly as the agent wrote it. */
    readonly command: string;
    /** The requested working directory, relative or absolute, if any. */
    readonly workdir: string | undefined;
    /** Writes a rewritten command back into the event's `input` in place. */
    readonly replaceCommand: (command: string) => void;
}

/**
 * Validates an `execute.before` event and returns the shell call it carries, or
 * `undefined` when it is not a well-formed shell invocation (another tool,
 * malformed payload, missing command).
 */
// eslint-disable-next-line sonarjs/function-return-type -- one value and the many `undefined` guards
export function parseShellCall(event: unknown): ShellCall | undefined {
    if (!isRecord(event)) {
        return undefined;
    }
    if (typeof event.tool !== "string" || !SHELL_TOOLS.includes(event.tool)) {
        return undefined;
    }
    const sessionID = event.sessionID;
    if (typeof sessionID !== "string" || sessionID === "") {
        return undefined;
    }
    const callID = event.id;
    if (typeof callID !== "string" || callID === "") {
        return undefined;
    }
    const input = event.input;
    if (!isRecord(input)) {
        return undefined;
    }
    const command = input.command;
    if (typeof command !== "string" || command === "") {
        return undefined;
    }
    const workdir = input.workdir;
    return {
        sessionID,
        callID,
        command,
        workdir: typeof workdir === "string" && workdir !== "" ? workdir : undefined,
        replaceCommand: (replacement) => {
            // The event's `input` is a live object; writing into it is the point.
            (input as Record<string, unknown>).command = replacement;
        },
    };
}

/**
 * The absolute directory a call runs in: `workdir` resolved against the
 * session `directory`, or the directory itself when no workdir was given.
 */
export function resolveCwd(directory: string, workdir: string | undefined): string {
    // `resolve` only yields `undefined` for an unknown cwd; ours is a string,
    // so the resolved path is always defined.
    return resolve(directory, workdir ?? ".") as string;
}
