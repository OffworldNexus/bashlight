/**
 * Parsing of OpenCode's `--format json` event stream.
 *
 * `opencode run --format json` writes one JSON object per line to stdout. The
 * benchmark only cares about a few of them, so this module is a pure fold over
 * the text: token usage and cost come from `step_finish`, tool activity from
 * `tool_use`, failures from `tool_use` error states and `error` events, and
 * the last passing test run from the shell tool calls in between.
 */

import { addTokens, EMPTY_TOKENS, type RunActivity, type TokenUsage } from "./types.ts";

/** A parsed JSON object, or `undefined` for anything else. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function asNumber(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asOptionalNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

/**
 * Whether a shell command looks like it runs the project's test suite, lint or
 * type checker. Deliberately broad: it only feeds the "last green" time, and a
 * false positive costs nothing but a slightly earlier number.
 */
export function isTestCommand(command: string): boolean {
    return (
        /\b(pytest|vitest|jest|mocha|mypy|ruff|tsc)\b/.test(command) ||
        /\b(pnpm|npm|yarn|bun)\s+(run\s+)?(test|lint|typecheck)\b/.test(command) ||
        /(^|[\s;&|])\.\/manage\.py\b/.test(command)
    );
}

/** Reads the nested `part.tokens` object of a `step_finish` event. */
function parseTokens(value: unknown): TokenUsage {
    const tokens = asRecord(value);
    if (tokens === undefined) {
        return EMPTY_TOKENS;
    }
    const cache = asRecord(tokens.cache);
    return {
        input: asNumber(tokens.input),
        output: asNumber(tokens.output),
        reasoning: asNumber(tokens.reasoning),
        cacheRead: asNumber(cache?.read),
        cacheWrite: asNumber(cache?.write),
    };
}

/** The command string of a shell tool part, or `undefined` for other tools. */
function shellCommand(
    toolState: Record<string, unknown> | undefined,
): string | undefined {
    return asString(asRecord(toolState?.input)?.command);
}

interface Accumulator {
    tokens: TokenUsage;
    costUsd: number;
    toolCalls: number;
    shellCalls: number;
    failedShellCalls: number;
    errors: string[];
    firstTimestamp: number | undefined;
    lastGreenTimestamp: number | undefined;
}

/** Folds a shell tool call into the shell counters and the last-green time. */
function applyToolUse(
    toolState: Record<string, unknown> | undefined,
    tool: string,
    status: string | undefined,
    timestamp: number | undefined,
    state: Accumulator,
): void {
    if (tool !== "shell" && tool !== "bash") {
        return;
    }
    state.shellCalls += 1;
    const exit = shellExitCode(toolState);
    if (status === "error" || exit !== 0) {
        state.failedShellCalls += 1;
        return;
    }
    const command = shellCommand(toolState);
    if (command !== undefined && isTestCommand(command) && timestamp !== undefined) {
        state.lastGreenTimestamp = timestamp;
    }
}

/** Folds a single already-parsed event into the accumulator. */
function applyEvent(event: Record<string, unknown>, state: Accumulator): void {
    const timestamp = asOptionalNumber(event.timestamp);
    if (timestamp !== undefined && state.firstTimestamp === undefined) {
        state.firstTimestamp = timestamp;
    }
    const type = asString(event.type);
    if (type === "step_finish") {
        const part = asRecord(event.part);
        state.costUsd += asNumber(part?.cost);
        state.tokens = addTokens(state.tokens, parseTokens(part?.tokens));
        return;
    }
    if (type === "tool_use") {
        const part = asRecord(event.part);
        const toolState = asRecord(part?.state);
        state.toolCalls += 1;
        applyToolUse(
            toolState,
            asString(part?.tool) ?? "unknown",
            asString(toolState?.status),
            timestamp,
            state,
        );
        return;
    }
    if (type === "error") {
        const error = asRecord(event.error);
        state.errors.push(asString(error?.message) ?? "unknown error");
    }
}

/** The exit code nested in a shell tool part, defaulting to 0 when absent. */
function shellExitCode(toolState: Record<string, unknown> | undefined): number {
    const metadata = asRecord(toolState?.metadata);
    const inner = asRecord(metadata?.metadata);
    const exit = inner?.exit ?? metadata?.exit;
    return typeof exit === "number" && Number.isFinite(exit) ? exit : 0;
}

/**
 * Parses the whole stdout of an `opencode run --format json` invocation.
 * Malformed lines (a partial tail, stray diagnostics) are ignored.
 */
export function parseActivity(text: string): RunActivity {
    const state: Accumulator = {
        tokens: EMPTY_TOKENS,
        costUsd: 0,
        toolCalls: 0,
        shellCalls: 0,
        failedShellCalls: 0,
        errors: [],
        firstTimestamp: undefined,
        lastGreenTimestamp: undefined,
    };
    for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (trimmed === "") {
            continue;
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(trimmed);
        } catch {
            continue;
        }
        const event = asRecord(parsed);
        if (event !== undefined) {
            applyEvent(event, state);
        }
    }
    const lastGreenMs =
        state.firstTimestamp !== undefined && state.lastGreenTimestamp !== undefined
            ? Math.max(0, state.lastGreenTimestamp - state.firstTimestamp)
            : 0;
    return {
        tokens: state.tokens,
        costUsd: state.costUsd,
        toolCalls: state.toolCalls,
        shellCalls: state.shellCalls,
        failedShellCalls: state.failedShellCalls,
        lastGreenMs,
        errors: state.errors,
    };
}
