/**
 * Aggregation and Markdown rendering of benchmark results.
 *
 * Results are one JSON object per run; the report groups them by model and
 * mode so the effect of the bashlight plugin is visible side by side. All the
 * arithmetic here is pure, so the report is testable from literal records.
 */

import type { Mode, RunRecord } from "./types.ts";

/** Per model × mode aggregates, every figure a per-run mean except `runs`. */
export interface ModelModeStats {
    readonly model: string;
    readonly mode: Mode;
    readonly runs: number;
    readonly successes: number;
    readonly successRate: number;
    readonly meanInput: number;
    readonly meanOutput: number;
    readonly meanCostUsd: number;
    readonly meanWallSeconds: number;
    readonly meanShellCalls: number;
    readonly meanFailedShellCalls: number;
    readonly meanRewrites: number;
}

const MODE_ORDER: readonly Mode[] = ["without", "with"];

function mean(values: readonly number[]): number {
    return values.length === 0
        ? 0
        : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Collapses records into one row per model × mode, ordered for reading. */
export function aggregate(records: readonly RunRecord[]): ModelModeStats[] {
    const groups = new Map<string, RunRecord[]>();
    for (const record of records) {
        const key = `${record.model}\u0000${record.mode}`;
        const bucket = groups.get(key);
        if (bucket === undefined) {
            groups.set(key, [record]);
        } else {
            bucket.push(record);
        }
    }
    const rows: ModelModeStats[] = [];
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
            meanCostUsd: mean(bucket.map((record) => record.costUsd)),
            meanWallSeconds: mean(bucket.map((record) => record.wallMs)) / 1000,
            meanShellCalls: mean(bucket.map((record) => record.shellCalls)),
            meanFailedShellCalls: mean(bucket.map((record) => record.failedShellCalls)),
            meanRewrites: mean(bucket.map((record) => record.rewrites)),
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

function formatPercent(value: number): string {
    return `${(value * 100).toFixed(0)}%`;
}

function formatTokens(value: number): string {
    return value.toFixed(0);
}

function formatSeconds(value: number): string {
    return value.toFixed(1);
}

function formatCost(value: number): string {
    return `$${value.toFixed(4)}`;
}

function formatMean(value: number): string {
    return value.toFixed(1);
}

/** Renders the aggregates as the body of `bench/RESULTS.md`. */
export function renderReport(
    records: readonly RunRecord[],
    title = "bashlight benchmark results",
): string {
    const rows = aggregate(records);
    const totalCost = records.reduce((sum, record) => sum + record.costUsd, 0);
    const successes = records.filter((record) => record.success).length;
    const lines: string[] = [
        `# ${title}`,
        "",
        `Runs: ${records.length} · Success: ${successes}/${records.length} · Total cost: ${formatCost(totalCost)}`,
        "",
        "All columns except `Runs` are per-run means.",
        "",
        "| Model | Mode | Runs | Success | In tok | Out tok | Cost | Wall (s) | Shell | Shell fail | Rewrites |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ];
    if (rows.length === 0) {
        lines.push("| _none_ |  |  |  |  |  |  |  |  |  |  |");
    }
    for (const row of rows) {
        const cells = [
            row.model,
            row.mode,
            String(row.runs),
            formatPercent(row.successRate),
            formatTokens(row.meanInput),
            formatTokens(row.meanOutput),
            formatCost(row.meanCostUsd),
            formatSeconds(row.meanWallSeconds),
            formatMean(row.meanShellCalls),
            formatMean(row.meanFailedShellCalls),
            formatMean(row.meanRewrites),
        ];
        lines.push(`| ${cells.join(" | ")} |`);
    }
    lines.push("");
    return lines.join("\n");
}
