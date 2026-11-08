/**
 * Short builders for rule verdicts, plus the resolver that turns a set of
 * `Replacement`s into concrete arguments.
 *
 * Rules describe the new argv in terms of the original arguments, so these
 * helpers keep each rule's `inspect` short and free of boilerplate.
 */
import type { CallArg, Replacement, Verdict } from "./rule.ts";

/** Runs the command as written. */
export function keep(): Verdict {
    return { kind: "keep" };
}

/** Refuses to run the command and shows `message` to the agent. */
export function block(message: string): Verdict {
    return { kind: "block", message };
}

/**
 * Runs a different argv. `env` variables are injected for this command only.
 * The `env` key is omitted when there is nothing to inject.
 */
export function replace(
    argv: readonly Replacement[],
    reason: string,
    env?: Readonly<Record<string, string>>,
): Verdict {
    return env === undefined
        ? { kind: "replace", argv, reason }
        : { kind: "replace", argv, reason, env };
}

/** Reuses the original argument at `index` (keeping its origin). */
export function arg(index: number): Replacement {
    return { kind: "arg", index };
}

/** Reuses every original argument of `argv`, from `from` to the end. */
export function argsFrom(
    argv: readonly CallArg[],
    from: number,
): readonly Replacement[] {
    return indexRange(from, argv.length).map((index) => arg(index));
}

/** The indices `from` (inclusive) to `to` (exclusive), clamped at 0. */
export function indexRange(from: number, to: number): number[] {
    const range: number[] = [];
    for (let index = Math.max(0, from); index < to; index += 1) {
        range.push(index);
    }
    return range;
}

/** New literal words with these exact values (the rewriter quotes them). */
export function text(...values: readonly string[]): readonly Replacement[] {
    return values.map((value): Replacement => ({ kind: "text", value }));
}

/**
 * Turns a `Replacement[]` into the `CallArg[]` it denotes for a given original
 * argv: `{ kind: "arg", index }` yields the original argument (same origin),
 * `{ kind: "text", value }` yields a literal.
 */
export class ReplacementResolver {
    constructor(private readonly original: readonly CallArg[]) {}

    resolve(replacements: readonly Replacement[]): readonly CallArg[] {
        return replacements.map((replacement) =>
            replacement.kind === "text"
                ? { value: replacement.value, origin: "literal" as const }
                : (this.original[replacement.index] ?? {
                      value: undefined,
                      origin: "unknown" as const,
                  }),
        );
    }
}
