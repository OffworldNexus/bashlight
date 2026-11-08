/**
 * The append-only results file: one JSON object per completed run.
 *
 * Results are small and useful, so they are committed; the raw event logs
 * under `bench/runs/` are not. Parsing skips anything malformed so a partial
 * write never breaks a report.
 */

import type { BenchFileSystem } from "./fs.ts";
import type { RunRecord } from "./types.ts";

/**
 * Whether a file name looks like a benchmark results file: the ISO timestamp
 * the runner writes, e.g. `2026-11-08T18-33-21-067Z.jsonl`. Anything else
 * (an archived `v1-…` file, a hand-written fixture) is never auto-discovered,
 * so the report can never mix versions.
 */
export function isResultsFileName(name: string): boolean {
    return /^\d{4}-\d{2}-\d{2}T.*\.jsonl$/.test(name);
}

/** Parses JSONL records, keeping only well-formed ones. */
export function parseResults(text: string): readonly RunRecord[] {
    const records: RunRecord[] = [];
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
        if (isRecord(parsed)) {
            records.push(parsed);
        }
    }
    return records;
}

function isRecord(value: unknown): value is RunRecord {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const record = value as Record<string, unknown>;
    return (
        typeof record.runId === "string" &&
        typeof record.project === "string" &&
        typeof record.model === "string" &&
        typeof record.success === "boolean" &&
        typeof record.costUsd === "number" &&
        typeof record.tokens === "object" &&
        record.tokens !== null
    );
}

/** Appends runs to the results file, reading them back for the report. */
export class ResultsStore {
    constructor(
        private readonly fs: BenchFileSystem,
        private readonly path: string,
    ) {}

    /** Appends one line, creating the file when needed. */
    append(record: RunRecord): void {
        const existing = this.fs.readFile(this.path) ?? "";
        this.fs.writeFile(this.path, `${existing}${JSON.stringify(record)}\n`);
    }

    /** Reads every recorded run, oldest first. */
    records(): readonly RunRecord[] {
        return parseResults(this.fs.readFile(this.path) ?? "");
    }
}
