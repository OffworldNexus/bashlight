/**
 * Launching `opencode run` headlessly.
 *
 * The binary is resolved once at construction; each run gets an isolated
 * environment and a per-run timeout. The JSON event stream is the caller's to
 * parse — this class only produces the raw {@link CommandResult}.
 */

import type { CommandResult } from "./command.ts";
import { ProcessRunner } from "./command.ts";

export interface OpenCodeRunInput {
    readonly model: string;
    readonly prompt: string;
    readonly cwd: string;
    readonly env: Readonly<Record<string, string>>;
    readonly timeoutMs: number;
}

/** Builds the argument vector for a headless, auto-approved run. */
export function openCodeArgs(model: string, prompt: string): readonly string[] {
    return [
        "run",
        "--standalone",
        "--format",
        "json",
        "--auto",
        "--model",
        model,
        prompt,
    ];
}

export class OpenCodeRunner {
    constructor(
        private readonly runner: ProcessRunner,
        private readonly binary = "opencode",
    ) {}

    run(input: OpenCodeRunInput): Promise<CommandResult> {
        return this.runner.run({
            command: this.binary,
            args: openCodeArgs(input.model, input.prompt),
            cwd: input.cwd,
            env: input.env,
            timeoutMs: input.timeoutMs,
        });
    }
}
