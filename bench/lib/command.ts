/**
 * Running external processes for the benchmark.
 *
 * Both the OpenCode run and the success checkers go through this class. It
 * spawns the process in its own group so a timeout can kill the whole tree
 * (OpenCode spawns a server and shell tools), captures stdout/stderr, and
 * reports how long the process lived.
 */

import { spawn } from "node:child_process";

export interface CommandInput {
    /** The executable, resolved through `PATH`. */
    readonly command: string;
    readonly args: readonly string[];
    readonly cwd: string;
    /** The complete environment; the parent's is replaced, not merged. */
    readonly env: Readonly<Record<string, string>>;
    readonly timeoutMs: number;
}

export interface CommandResult {
    readonly code: number | null;
    readonly signal: string | null;
    readonly stdout: string;
    readonly stderr: string;
    readonly timedOut: boolean;
    readonly durationMs: number;
}

/** Injected time source so tests can observe durations deterministically. */
export interface Clock {
    now(): number;
}

/** Spawns and supervises one process, killing its group on timeout. */
export class ProcessRunner {
    constructor(private readonly clock: Clock = Date) {}

    run(input: CommandInput): Promise<CommandResult> {
        return new Promise((resolve) => {
            const started = this.clock.now();
            const child = spawn(input.command, [...input.args], {
                cwd: input.cwd,
                env: { ...input.env },
                detached: true,
                stdio: ["ignore", "pipe", "pipe"],
            });
            let stdout = "";
            let stderr = "";
            let timedOut = false;
            child.stdout?.on("data", (chunk: Buffer) => {
                stdout += chunk.toString("utf8");
            });
            child.stderr?.on("data", (chunk: Buffer) => {
                stderr += chunk.toString("utf8");
            });
            const timer = setTimeout(() => {
                timedOut = true;
                killGroup(child.pid);
            }, input.timeoutMs);
            const finish = (code: number | null, signal: NodeJS.Signals | null) => {
                clearTimeout(timer);
                resolve({
                    code,
                    signal,
                    stdout,
                    stderr,
                    timedOut,
                    durationMs: this.clock.now() - started,
                });
            };
            child.on("error", (error) => {
                clearTimeout(timer);
                resolve({
                    code: null,
                    signal: null,
                    stdout,
                    stderr: `${stderr}${String(error)}\n`,
                    timedOut,
                    durationMs: this.clock.now() - started,
                });
            });
            child.on("close", finish);
        });
    }
}

/** Kills the process group led by `pid`, ignoring an already-dead process. */
function killGroup(pid: number | undefined): void {
    if (pid === undefined) {
        return;
    }
    try {
        process.kill(-pid, "SIGKILL");
    } catch {
        try {
            process.kill(pid, "SIGKILL");
        } catch {
            // Already gone.
        }
    }
}
