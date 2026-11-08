/**
 * Bridges the interpreter's `Invocation` to the rules' `CommandCall`: it
 * classifies each argument by where its value came from and hands the
 * invocation's environment through unchanged.
 */

import type { Invocation } from "../interp/invocation.ts";
import type { Arg } from "../interp/values.ts";
import type { ArgOrigin, CommandCall } from "../rules/rule.ts";

function classifyArg(arg: Arg): ArgOrigin {
    const fragments = arg.fragments;
    if (fragments.length > 0 && fragments.every((f) => f.origin.kind === "literal")) {
        return "literal";
    }
    const first = fragments[0];
    if (first !== undefined && first.origin.kind === "binding") {
        const binding = first.origin.binding;
        const single = fragments.every(
            (f) => f.origin.kind === "binding" && f.origin.binding === binding,
        );
        if (single) {
            return "variable";
        }
    }
    if (fragments.length > 0 && fragments.every((f) => f.origin.kind === "computed")) {
        return "computed";
    }
    if (arg.value === undefined) {
        return "unknown";
    }
    return "mixed";
}

export function toCommandCall(invocation: Invocation): CommandCall {
    return {
        argv: invocation.argv.map((arg) => ({
            value: arg.value,
            origin: classifyArg(arg),
        })),
        env: invocation.env,
        ...(invocation.stdin === undefined ? {} : { stdin: invocation.stdin }),
    };
}

/** Only external commands with a known `argv[0]` are shown to the rules. */
export function isSubmitted(invocation: Invocation): boolean {
    return invocation.kind === "external" && invocation.argv[0]?.value !== undefined;
}

/** Index of a `fullArgv` entry within the invocation's effective `argv`. */
export function toArgvIndex(invocation: Invocation, fullIndex: number): number {
    return fullIndex - invocation.offset;
}
