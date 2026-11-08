/** Resolves a rule's replacement argv against the original arguments. */

import type { Arg } from "../interp/values.ts";
import type { Replacement } from "../rules/rule.ts";

/**
 * The values a `Replacement[]` denotes for an original effective argv:
 * `{ kind: "arg", index }` takes the original argument's value (which may be
 * unknown), `{ kind: "text", value }` is a literal.
 */
export function resolveValues(
    argv: readonly Arg[],
    replacements: readonly Replacement[],
): (string | undefined)[] {
    return replacements.map((replacement) =>
        replacement.kind === "text"
            ? replacement.value
            : argv[replacement.index]?.value,
    );
}
