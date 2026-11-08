/* eslint-disable sonarjs/function-return-type -- the outcome parser returns undefined for malformed lines */
/**
 * Summarising the bashlight audit log.
 *
 * The plugin appends one JSON object per shell call it inspected
 * (`{ outcome: "rewritten" | "blocked" | "unchanged", ... }`). The benchmark
 * only needs the tallies, so this is a pure function over the log text; blank
 * and malformed lines are skipped exactly as the reader does.
 */

import type { AuditSummary } from "./types.ts";

function outcomeOf(line: string): string | undefined {
    const trimmed = line.trim();
    if (trimmed === "") {
        return undefined;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(trimmed);
    } catch {
        return undefined;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return undefined;
    }
    const outcome = (parsed as Record<string, unknown>).outcome;
    return typeof outcome === "string" ? outcome : undefined;
}

/** Counts rewrite/block/unchanged entries in a JSONL audit log. */
export function summarizeAudit(text: string): AuditSummary {
    let rewrites = 0;
    let blocks = 0;
    let unchanged = 0;
    for (const line of text.split("\n")) {
        const outcome = outcomeOf(line);
        switch (outcome) {
            case "rewritten":
                rewrites += 1;
                break;
            case "blocked":
                blocks += 1;
                break;
            case "unchanged":
                unchanged += 1;
                break;
            default:
                break;
        }
    }
    return { rewrites, blocks, unchanged };
}

/** An empty summary, used when a run has no audit log at all. */
export const EMPTY_AUDIT: AuditSummary = { rewrites: 0, blocks: 0, unchanged: 0 };
