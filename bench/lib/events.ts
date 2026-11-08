/**
 * Parsing of OpenCode's `--format json` event stream.
 *
 * `opencode run --format json` writes one JSON object per line to stdout. The
 * benchmark only cares about a few of them, so this module is a pure fold over
 * the text: token usage and cost come from `step_finish`, tool activity from
 * `tool_use`, and failures from `tool_use` error states and `error` events.
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

function asString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
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

interface Accumulator {
    tokens: TokenUsage;
    costUsd: number;
    toolCalls: number;
    shellCalls: number;
    failedShellCalls: number;
    errors: string[];
}

/** Folds a single already-parsed event into the accumulator. */
function applyEvent(event: Record<string, unknown>, state: Accumulator): void {
    const type = asString(event.type);
    if (type === "step_finish") {
        const part = asRecord(event.part);
        state.costUsd += asNumber(part?.cost);
        state.tokens = addTokens(state.tokens, parseTokens(part?.tokens));
        return;
    }
    if (type === "tool_use") {
        const part = asRecord(event.part);
        const tool = asString(part?.tool) ?? "unknown";
        const toolState = asRecord(part?.state);
        const status = asString(toolState?.status);
        state.toolCalls += 1;
        if (tool === "shell" || tool === "bash") {
            state.shellCalls += 1;
            if (status === "error" || shellExitCode(toolState) !== 0) {
                state.failedShellCalls += 1;
            }
        }
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
    return {
        tokens: state.tokens,
        costUsd: state.costUsd,
        toolCalls: state.toolCalls,
        shellCalls: state.shellCalls,
        failedShellCalls: state.failedShellCalls,
        errors: state.errors,
    };
}
