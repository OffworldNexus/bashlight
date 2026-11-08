/**
 * Aggregation and Markdown rendering of benchmark results.
 *
 * Results are one JSON object per run; the report groups them by model × mode
 * and by project × mode so the effect of the bashlight plugin is visible side
 * by side. All the arithmetic here is pure, so the report is testable from
 * literal records.
 */

import { type Mode, type RunRecord, totalTokens } from "./types.ts";

/** Per model × mode aggregates, every figure a per-run mean except `runs`. */
export interface ModelModeStats {
    readonly model: string;
    readonly mode: Mode;
    readonly runs: number;
    readonly successes: number;
    readonly successRate: number;
    readonly meanInput: number;
    readonly meanOutput: number;
    readonly meanTotal: number;
    readonly meanCostUsd: number;
    readonly meanWallSeconds: number;
    readonly meanShellCalls: number;
    readonly meanFailedShellCalls: number;
    readonly meanRewrites: number;
    readonly meanLastGreenSeconds: number;
}

/** Per project × mode aggregates, same shape minus the model. */
export interface ProjectModeStats {
    readonly project: string;
    readonly mode: Mode;
    readonly runs: number;
    readonly successes: number;
    readonly successRate: number;
    readonly meanCostUsd: number;
    readonly meanWallSeconds: number;
    readonly meanShellCalls: number;
    readonly meanFailedShellCalls: number;
    readonly meanRewrites: number;
    readonly meanLastGreenSeconds: number;
}

const MODE_ORDER: readonly Mode[] = ["without", "with"];

function mean(values: readonly number[]): number {
    return values.length === 0
        ? 0
        : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Groups records by a string key, preserving first-seen order. */
function group(
    records: readonly RunRecord[],
    key: (record: RunRecord) => string,
): Map<string, RunRecord[]> {
    const groups = new Map<string, RunRecord[]>();
    for (const record of records) {
        const bucket = groups.get(key(record));
        if (bucket === undefined) {
            groups.set(key(record), [record]);
        } else {
            bucket.push(record);
        }
    }
    return groups;
}

/** Collapses records into one row per model × mode, ordered for reading. */
export function aggregate(records: readonly RunRecord[]): ModelModeStats[] {
    const rows: ModelModeStats[] = [];
    const groups = group(records, (record) => `${record.model}\u0000${record.mode}`);
    for (const bucket of groups.values()) {
        const first = bucket[0];
        if (first === undefined) {
            continue;
        }
        const successes = bucket.filter((record) => record.success).length;
        rows.push({
            model: first.model,
            mode: first.mode,
            runs: bucket.length,
            successes,
            successRate: successes / bucket.length,
            meanInput: mean(bucket.map((record) => record.tokens.input)),
            meanOutput: mean(
                bucket.map((record) => record.tokens.output + record.tokens.reasoning),
            ),
            meanTotal: mean(bucket.map((record) => totalTokens(record.tokens))),
            meanCostUsd: mean(bucket.map((record) => record.costUsd)),
            meanWallSeconds: mean(bucket.map((record) => record.wallMs)) / 1000,
            meanShellCalls: mean(bucket.map((record) => record.shellCalls)),
            meanFailedShellCalls: mean(bucket.map((record) => record.failedShellCalls)),
            meanRewrites: mean(bucket.map((record) => record.rewrites)),
            meanLastGreenSeconds:
                mean(bucket.map((record) => record.lastGreenMs ?? 0)) / 1000,
        });
    }
    rows.sort((left, right) => {
        const byModel = left.model.localeCompare(right.model);
        if (byModel !== 0) {
            return byModel;
        }
        return MODE_ORDER.indexOf(left.mode) - MODE_ORDER.indexOf(right.mode);
    });
    return rows;
}

/** Collapses records into one row per project × mode, ordered for reading. */
export function aggregateByProject(records: readonly RunRecord[]): ProjectModeStats[] {
    const rows: ProjectModeStats[] = [];
    const groups = group(records, (record) => `${record.project}\u0000${record.mode}`);
    for (const bucket of groups.values()) {
        const first = bucket[0];
        if (first === undefined) {
            continue;
        }
        const successes = bucket.filter((record) => record.success).length;
        rows.push({
            project: first.project,
            mode: first.mode,
            runs: bucket.length,
            successes,
            successRate: successes / bucket.length,
            meanCostUsd: mean(bucket.map((record) => record.costUsd)),
            meanWallSeconds: mean(bucket.map((record) => record.wallMs)) / 1000,
            meanShellCalls: mean(bucket.map((record) => record.shellCalls)),
            meanFailedShellCalls: mean(bucket.map((record) => record.failedShellCalls)),
            meanRewrites: mean(bucket.map((record) => record.rewrites)),
            meanLastGreenSeconds:
                mean(bucket.map((record) => record.lastGreenMs ?? 0)) / 1000,
        });
    }
    rows.sort((left, right) => {
        const byProject = left.project.localeCompare(right.project);
        if (byProject !== 0) {
            return byProject;
        }
        return MODE_ORDER.indexOf(left.mode) - MODE_ORDER.indexOf(right.mode);
    });
    return rows;
}

/**
 * Merges several results files into one record set, dropping later duplicates
 * of the same `runId` (so re-running a file does not double-count).
 */
export function mergeRecords(
    sources: readonly (readonly RunRecord[])[],
): readonly RunRecord[] {
    const seen = new Set<string>();
    const merged: RunRecord[] = [];
    for (const records of sources) {
        for (const record of records) {
            const key = record.runId;
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            merged.push(record);
        }
    }
    return merged;
}

function formatPercent(value: number): string {
    return `${(value * 100).toFixed(0)}%`;
}

function formatInteger(value: number): string {
    return value.toFixed(0);
}

function formatSeconds(value: number): string {
    return value.toFixed(1);
}

function formatCost(value: number): string {
    return `$${value.toFixed(4)}`;
}

function table(
    header: readonly string[],
    rows: readonly (readonly string[])[],
    rightAligned: readonly number[],
): string[] {
    const widths = header.map((cell, index) =>
        Math.max(cell.length, ...rows.map((row) => (row[index] ?? "").length)),
    );
    const pad = (value: string, index: number) =>
        rightAligned.includes(index)
            ? value.padStart(widths[index] ?? 0)
            : value.padEnd(widths[index] ?? 0);
    const headerLine = `| ${header.map((cell, index) => pad(cell, index)).join(" | ")} |`;
    const separator = `| ${header
        .map((_, index) =>
            rightAligned.includes(index)
                ? `${"-".repeat(Math.max(1, (widths[index] ?? 1) - 1))}:`
                : "-".repeat(widths[index] ?? 1),
        )
        .join(" | ")} |`;
    const dataLines = rows.map(
        (row) => `| ${row.map((cell, index) => pad(cell ?? "", index)).join(" | ")} |`,
    );
    return [headerLine, separator, ...dataLines];
}

/** Renders the aggregates as the body of `bench/RESULTS.md`. */
export function renderReport(
    records: readonly RunRecord[],
    title = "bashlight benchmark results",
): string {
    const models = aggregate(records);
    const projects = aggregateByProject(records);
    const totalCost = records.reduce((sum, record) => sum + record.costUsd, 0);
    const successes = records.filter((record) => record.success).length;
    const lines: string[] = [
        `# ${title}`,
        "",
        `Runs: ${records.length} · Success: ${successes}/${records.length} · Total cost: ${formatCost(totalCost)}`,
        "",
        "All columns except `Runs` are per-run means.",
        "",
        "## By model",
        "",
        ...table(
            [
                "Model",
                "Mode",
                "Runs",
                "Success",
                "In tok",
                "Out tok",
                "Cost",
                "Wall (s)",
                "Shell",
                "Shell fail",
                "Rewrites",
                "Green (s)",
            ],
            models.map((row) => [
                row.model,
                row.mode,
                String(row.runs),
                formatPercent(row.successRate),
                formatInteger(row.meanInput),
                formatInteger(row.meanOutput),
                formatCost(row.meanCostUsd),
                formatSeconds(row.meanWallSeconds),
                formatSeconds(row.meanShellCalls),
                formatSeconds(row.meanFailedShellCalls),
                formatSeconds(row.meanRewrites),
                formatSeconds(row.meanLastGreenSeconds),
            ]),
            [2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
        ),
        "",
        "## By project",
        "",
        ...table(
            [
                "Project",
                "Mode",
                "Runs",
                "Success",
                "Cost",
                "Wall (s)",
                "Shell fail",
                "Rewrites",
                "Green (s)",
            ],
            projects.map((row) => [
                row.project,
                row.mode,
                String(row.runs),
                formatPercent(row.successRate),
                formatCost(row.meanCostUsd),
                formatSeconds(row.meanWallSeconds),
                formatSeconds(row.meanFailedShellCalls),
                formatSeconds(row.meanRewrites),
                formatSeconds(row.meanLastGreenSeconds),
            ]),
            [2, 3, 4, 5, 6, 7, 8],
        ),
    ];
    return `${lines.join("\n")}\n`;
}
