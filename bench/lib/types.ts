/**
 * Shared types for the bashlight benchmark harness.
 *
 * The benchmark is deliberately small: a handful of fake projects, one task
 * each, run headless through OpenCode with and without the bashlight plugin.
 * Everything under `bench/` is self-contained and pure where it can be, so the
 * event parsing, aggregation and reporting are unit-tested without a network.
 */

/** Whether the bashlight plugin is installed in the run. */
export type Mode = "with" | "without";

/** A single assistant step's token accounting, mirrored from OpenCode. */
export interface TokenUsage {
    readonly input: number;
    readonly output: number;
    readonly reasoning: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
}

/** An all-zero usage, useful as the fold seed. */
export const EMPTY_TOKENS: TokenUsage = {
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
};

/** Adds two usages field by field. */
export function addTokens(left: TokenUsage, right: TokenUsage): TokenUsage {
    return {
        input: left.input + right.input,
        output: left.output + right.output,
        reasoning: left.reasoning + right.reasoning,
        cacheRead: left.cacheRead + right.cacheRead,
        cacheWrite: left.cacheWrite + right.cacheWrite,
    };
}

/** The total number of tokens across every bucket. */
export function totalTokens(tokens: TokenUsage): number {
    return (
        tokens.input +
        tokens.output +
        tokens.reasoning +
        tokens.cacheRead +
        tokens.cacheWrite
    );
}

/** What the model/tooling did during one run, parsed from the event stream. */
export interface RunActivity {
    readonly tokens: TokenUsage;
    readonly costUsd: number;
    readonly toolCalls: number;
    readonly shellCalls: number;
    readonly failedShellCalls: number;
    /**
     * Milliseconds from the first event to the last successful test-like shell
     * command, or 0 when the agent never ran a test that passed. A "green"
     * moment means the agent had a passing suite at that point, not that it
     * stopped there.
     */
    readonly lastGreenMs: number;
    readonly errors: readonly string[];
}

/** What bashlight did during one run, parsed from its audit log. */
export interface AuditSummary {
    readonly rewrites: number;
    readonly blocks: number;
    readonly unchanged: number;
}

/** The outcome of a task-specific success checker. */
export interface CheckResult {
    readonly success: boolean;
    readonly detail: string;
}

/** One complete benchmark run, the unit of the results file. */
export interface RunRecord {
    readonly runId: string;
    readonly timestamp: string;
    readonly project: string;
    readonly mode: Mode;
    readonly model: string;
    readonly success: boolean;
    readonly detail: string;
    readonly wallMs: number;
    readonly tokens: TokenUsage;
    readonly costUsd: number;
    readonly toolCalls: number;
    readonly shellCalls: number;
    readonly failedShellCalls: number;
    readonly rewrites: number;
    readonly blocks: number;
    /** Present from benchmark v2 on; older records omit it. */
    readonly lastGreenMs?: number;
    readonly error?: string;
}
