/* eslint-disable sonarjs/function-return-type */
/**
 * Small helpers shared by the wrapper strategies: program-name matching,
 * command/script result builders, and `NAME=value` parsing.
 */

import { basename, resolve as resolveAgainst } from "../../shared/posix-path.ts";
import type { ScriptSource } from "../documents.ts";
import type { Scope } from "../environment.ts";
import type { Arg } from "../values.ts";
import type { EffectiveCommand, EffectiveScript, UnwrapInput } from "./types.ts";

/** Whether a word starts with `-` and is not `-` or `--`. */
export function isOption(value: string | undefined): boolean {
    return (
        value !== undefined &&
        value.length > 1 &&
        value.startsWith("-") &&
        value !== "--"
    );
}

export function isIdentifier(value: string): boolean {
    return /^[A-Za-z_]\w*$/.test(value);
}

/** Splits a `NAME=value` word, or returns `undefined` when it is not one. */
export function assignmentParts(
    value: string,
): { readonly name: string; readonly value: string } | undefined {
    const eq = value.indexOf("=");
    if (eq <= 0) {
        return undefined;
    }
    const name = value.slice(0, eq);
    if (!isIdentifier(name)) {
        return undefined;
    }
    return { name, value: value.slice(eq + 1) };
}

/** Whether a word looks like `NAME=value` (`env`-style assignment). */
export function isAssignmentArg(value: string | undefined): boolean {
    return value !== undefined && assignmentParts(value) !== undefined;
}

/**
 * The wrapper's name when its command word is one of `names` (by basename),
 * otherwise `undefined`.
 */
export function matchesProgram(
    input: UnwrapInput,
    names: readonly string[],
): string | undefined {
    const first = input.argv[0]?.value;
    if (first === undefined) {
        return undefined;
    }
    const program = basename(first);
    return names.includes(program) ? program : undefined;
}

export function commandResult(offset: number, scope: Scope): EffectiveCommand {
    return { kind: "command", offset, end: undefined, scope };
}

export function scriptResult(
    source: ScriptSource,
    scope: Scope,
    invocationKind: "external" | "builtin",
    stdinText?: string,
): EffectiveScript {
    const result: EffectiveScript = {
        kind: "script",
        source,
        scope,
        invocationKind,
    };
    return stdinText === undefined ? result : { ...result, stdinText };
}

/** A directory resolved against the current cwd, or `undefined` if unknown. */
export function resolveDirectory(scope: Scope, dir: string): string | undefined {
    return resolveAgainst(scope.env.cwd, dir);
}

export type { Arg };
