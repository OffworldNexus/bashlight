/* eslint-disable sonarjs/function-return-type */
/**
 * Running an external program, for the `doctor` probes (`bun --version`,
 * `opencode --version`).
 *
 * The adapter is synchronous and total: a program that cannot be launched (not
 * on `PATH`) is reported as `undefined`, never as a throw.
 */

import { spawnSync } from "node:child_process";

/** The outcome of one finished process. */
export interface RunResult {
    readonly status: number;
    readonly stdout: string;
    readonly stderr: string;
}

/** Runs programs by name, resolving them through `PATH`. */
export interface ProcessRunner {
    /** Runs `program` with `args`; `undefined` when it cannot be launched. */
    run(program: string, args: readonly string[]): RunResult | undefined;
}

/** The production `ProcessRunner`, backed by `spawnSync`. */
export class NodeProcessRunner implements ProcessRunner {
    run(program: string, args: readonly string[]): RunResult | undefined {
        try {
            const result = spawnSync(program, [...args], { encoding: "utf8" });
            if (result.error !== undefined || result.status === null) {
                return undefined;
            }
            return {
                status: result.status,
                stdout: result.stdout ?? "",
                stderr: result.stderr ?? "",
            };
        } catch {
            return undefined;
        }
    }
}
