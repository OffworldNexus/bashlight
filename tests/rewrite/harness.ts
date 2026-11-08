/**
 * Helpers for the rewrite unit tests: run the full pipeline with a custom rule
 * set so a specific strategy can be forced deterministically. The pipeline
 * builder itself is shared with the end-to-end cases.
 */

import type { Outcome } from "../../src/outcome.ts";
import type { Rule } from "../../src/rules/rule.ts";
import { type Fixtures, runCommand, type RunOptions } from "../cases/fixtures.ts";

export type { Fixtures, RunOptions };
export function runWithRules(
    rules: readonly Rule[],
    command: string,
    options: RunOptions = {},
): Outcome {
    return runCommand(command, { ...options, rules });
}

export function commandWithRules(
    rules: readonly Rule[],
    command: string,
    options: RunOptions = {},
): string | undefined {
    const outcome = runWithRules(rules, command, options);
    return outcome.kind === "rewritten" ? outcome.command : undefined;
}
