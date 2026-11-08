/**
 * Helpers for the rewrite unit tests: run the full pipeline with a custom rule
 * set so a specific strategy can be forced deterministically.
 */

import { createBashlight } from "../../src/bashlight.ts";
import type { Outcome } from "../../src/outcome.ts";
import { MemoryFileSystem } from "../../src/project/index.ts";
import type { Rule } from "../../src/rules/rule.ts";
import type { Fixtures } from "../cases/fixtures.ts";

export interface CustomRun {
    readonly cwd?: string;
    readonly files?: Fixtures;
    readonly env?: Readonly<Record<string, string>>;
}

export function runWithRules(
    rules: readonly Rule[],
    command: string,
    options: CustomRun = {},
): Outcome {
    const processor = createBashlight({
        fileSystem: new MemoryFileSystem(options.files ?? {}),
        rules,
    });
    return processor.process({
        command,
        cwd: options.cwd ?? "/w",
        env: options.env ?? { HOME: "/home/user", PATH: "/usr/bin:/bin" },
    });
}

export function commandWithRules(
    rules: readonly Rule[],
    command: string,
    options: CustomRun = {},
): string | undefined {
    const outcome = runWithRules(rules, command, options);
    return outcome.kind === "rewritten" ? outcome.command : undefined;
}
