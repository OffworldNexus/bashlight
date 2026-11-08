/**
 * Aggregation and Markdown rendering of benchmark results.
 *
 * The benchmark compares two modes, so every comparison must be apples to
 * apples: only **matched cells** count. A cell is a (project, model) pair, and
 * it is matched only when it has at least one completed run in *both* modes.
 * Aggregates over models or projects are computed from matched cells only, and
 * each cell contributes once (equal weight per cell) so a long project cannot
 * dominate one side. Runs outside any matched cell are reported separately.
 *
 * All the arithmetic here is pure, so it is testable from literal records.
 */

import { displayName } from "./models.ts";
import { type Mode, type RunRecord, totalTokens } from "./types.ts";

export type Metric = (record: RunRecord) => number;

/** The numeric metrics the report aggregates. */
export const successMetric: Metric = (record) => (record.success ? 1 : 0);
export const costMetric: Metric = (record) => record.costUsd;
export const wallMetric: Metric = (record) => record.wallMs / 1000;
export const failedMetric: Metric = (record) => record.failedShellCalls;

/** A (project, model) cell: the unit that is matched and weighted. */
export interface CellKey {
    readonly project: string;
    readonly model: string;
}

/** A stable map key for a cell. */
export function cellId(cell: CellKey): string {
    return `${cell.project}\u0000${cell.model}`;
}

/** The result of matching records into comparable cells. */
export interface CellIndex {
    /** Matched cells, sorted by project then model. */
    readonly matched: readonly CellKey[];
    /** Every run that belongs to a matched cell. */
    readonly matchedRuns: readonly RunRecord[];
    /** Every run whose cell is missing a run in one of the modes. */
    readonly excluded: readonly RunRecord[];
    /** Runs per matched cell, in `with` mode. */
    readonly withRuns: ReadonlyMap<string, readonly RunRecord[]>;
    /** Runs per matched cell, in `without` mode. */
    readonly withoutRuns: ReadonlyMap<string, readonly RunRecord[]>;
}

export function mean(values: readonly number[]): number {
    return values.length === 0
        ? 0
        : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** The median of a numeric sample; 0 for an empty one. */
export function median(values: readonly number[]): number {
    if (values.length === 0) {
        return 0;
    }
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) {
        return sorted[middle] ?? 0;
    }
    return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/** Groups a (project, model) cell into the with/without run buckets. */
function bucketRuns(records: readonly RunRecord[]): {
    readonly withRuns: Map<string, RunRecord[]>;
    readonly withoutRuns: Map<string, RunRecord[]>;
    readonly keys: Map<string, CellKey>;
} {
    const withRuns = new Map<string, RunRecord[]>();
    const withoutRuns = new Map<string, RunRecord[]>();
    const keys = new Map<string, CellKey>();
    const push = (map: Map<string, RunRecord[]>, id: string, record: RunRecord) => {
        const bucket = map.get(id);
        if (bucket === undefined) {
            map.set(id, [record]);
        } else {
            bucket.push(record);
        }
    };
    for (const record of records) {
        const cell = { project: record.project, model: record.model };
        const id = cellId(cell);
        keys.set(id, cell);
        push(record.mode === "with" ? withRuns : withoutRuns, id, record);
    }
    return { withRuns, withoutRuns, keys };
}

/** Keeps only the cells that have a completed run in both modes. */
export function matchCells(records: readonly RunRecord[]): CellIndex {
    const { withRuns, withoutRuns, keys } = bucketRuns(records);
    const matched: CellKey[] = [];
    for (const [id, cell] of keys) {
        if (
            (withRuns.get(id)?.length ?? 0) > 0 &&
            (withoutRuns.get(id)?.length ?? 0) > 0
        ) {
            matched.push(cell);
        }
    }
    matched.sort((left, right) => {
        const byProject = left.project.localeCompare(right.project);
        return byProject !== 0 ? byProject : left.model.localeCompare(right.model);
    });
    const matchedIds = new Set(matched.map(cellId));
    const matchedRuns = records.filter((record) =>
        matchedIds.has(cellId({ project: record.project, model: record.model })),
    );
    const excluded = records.filter(
        (record) =>
            !matchedIds.has(cellId({ project: record.project, model: record.model })),
    );
    return { matched, matchedRuns, excluded, withRuns, withoutRuns };
}

/** The runs of one matched cell in one mode. */
function runsFor(index: CellIndex, cell: CellKey, mode: Mode): readonly RunRecord[] {
    const map = mode === "with" ? index.withRuns : index.withoutRuns;
    return map.get(cellId(cell)) ?? [];
}

/**
 * One mean per matched cell satisfying `select`, in `mode`. Averaging this
 * array gives every cell equal weight regardless of how many runs it holds.
 */
export function cellMeans(
    index: CellIndex,
    select: (cell: CellKey) => boolean,
    mode: Mode,
    metric: Metric,
): readonly number[] {
    return index.matched
        .filter(select)
        .map((cell) => mean(runsFor(index, cell, mode).map(metric)));
}

/** Sorted, unique models among the matched cells. */
export function modelsIn(index: CellIndex): readonly string[] {
    return [...new Set(index.matched.map((cell) => cell.model))].sort((a, b) =>
        a.localeCompare(b),
    );
}

/** Sorted, unique projects among the matched cells. */
export function projectsIn(index: CellIndex): readonly string[] {
    return [...new Set(index.matched.map((cell) => cell.project))].sort((a, b) =>
        a.localeCompare(b),
    );
}

/** Per-cell metrics, before the equal-weight combination across cells. */
interface CellMetrics {
    readonly runs: number;
    readonly successRate: number;
    readonly input: number;
    readonly output: number;
    readonly total: number;
    readonly costUsd: number;
    readonly wallSeconds: number;
    readonly shellCalls: number;
    readonly failedShellCalls: number;
    readonly rewrites: number;
    readonly lastGreenSeconds: number;
}

function cellMetrics(runs: readonly RunRecord[]): CellMetrics {
    return {
        runs: runs.length,
        successRate: mean(runs.map(successMetric)),
        input: mean(runs.map((record) => record.tokens.input)),
        output: mean(
            runs.map((record) => record.tokens.output + record.tokens.reasoning),
        ),
        total: mean(runs.map((record) => totalTokens(record.tokens))),
        costUsd: mean(runs.map(costMetric)),
        wallSeconds: mean(runs.map(wallMetric)),
        shellCalls: mean(runs.map((record) => record.shellCalls)),
        failedShellCalls: mean(runs.map(failedMetric)),
        rewrites: mean(runs.map((record) => record.rewrites)),
        lastGreenSeconds: mean(runs.map((record) => (record.lastGreenMs ?? 0) / 1000)),
    };
}

/** Averages cell metrics with equal weight per cell; `runs` sums instead. */
function combineCells(cells: readonly CellMetrics[]): CellMetrics {
    return {
        runs: cells.reduce((sum, cell) => sum + cell.runs, 0),
        successRate: mean(cells.map((cell) => cell.successRate)),
        input: mean(cells.map((cell) => cell.input)),
        output: mean(cells.map((cell) => cell.output)),
        total: mean(cells.map((cell) => cell.total)),
        costUsd: mean(cells.map((cell) => cell.costUsd)),
        wallSeconds: mean(cells.map((cell) => cell.wallSeconds)),
        shellCalls: mean(cells.map((cell) => cell.shellCalls)),
        failedShellCalls: mean(cells.map((cell) => cell.failedShellCalls)),
        rewrites: mean(cells.map((cell) => cell.rewrites)),
        lastGreenSeconds: mean(cells.map((cell) => cell.lastGreenSeconds)),
    };
}

/** Per model × mode aggregates, equal-weighted over matched cells. */
export interface ModelModeStats extends CellMetrics {
    readonly model: string;
    readonly mode: Mode;
    readonly cells: number;
}

/** Per project × mode aggregates, equal-weighted over matched cells. */
export interface ProjectModeStats extends CellMetrics {
    readonly project: string;
    readonly mode: Mode;
    readonly cells: number;
}

const MODE_ORDER: readonly Mode[] = ["without", "with"];

/** Collapses matched cells into one row per model × mode. */
export function aggregate(index: CellIndex): ModelModeStats[] {
    const rows: ModelModeStats[] = [];
    for (const model of modelsIn(index)) {
        for (const mode of MODE_ORDER) {
            const cells = index.matched.filter((cell) => cell.model === model);
            const combined = combineCells(
                cells.map((cell) => cellMetrics(runsFor(index, cell, mode))),
            );
            rows.push({ model, mode, cells: cells.length, ...combined });
        }
    }
    return rows;
}

/** Collapses matched cells into one row per project × mode. */
export function aggregateByProject(index: CellIndex): ProjectModeStats[] {
    const rows: ProjectModeStats[] = [];
    for (const project of projectsIn(index)) {
        for (const mode of MODE_ORDER) {
            const cells = index.matched.filter((cell) => cell.project === project);
            const combined = combineCells(
                cells.map((cell) => cellMetrics(runsFor(index, cell, mode))),
            );
            rows.push({ project, mode, cells: cells.length, ...combined });
        }
    }
    return rows;
}

/** Which direction of a metric is an improvement. */
export type Direction = "lower" | "higher";
/** Whether a change is expressed as a percentage or percentage points. */
export type DeltaUnit = "percent" | "points";

/** One relative change, ready to label and colour. */
export interface Delta {
    readonly value: number;
    readonly label: string;
    readonly tone: "better" | "worse" | "same";
    readonly available: boolean;
}

/** The `n/a` delta used when there is no baseline to compare against. */
export const UNAVAILABLE_DELTA: Delta = {
    value: Number.NaN,
    label: "n/a",
    tone: "same",
    available: false,
};

/** Formats a signed change, e.g. `−18%` or `+12 pp`. */
export function formatDelta(value: number, unit: DeltaUnit): string {
    const magnitude = Math.abs(value).toFixed(0);
    const rendered = unit === "percent" ? `${magnitude}%` : `${magnitude} pp`;
    if (value > 0) {
        return `+${rendered}`;
    }
    if (value < 0) {
        return `−${rendered}`;
    }
    return rendered;
}

/** Formats and classifies an already-computed change. */
export function deltaFromValue(
    value: number,
    direction: Direction,
    unit: DeltaUnit,
): Pick<Delta, "label" | "tone"> {
    let tone: Delta["tone"];
    if (value === 0) {
        tone = "same";
    } else if (direction === "lower") {
        tone = value < 0 ? "better" : "worse";
    } else {
        tone = value > 0 ? "better" : "worse";
    }
    return { label: formatDelta(value, unit), tone };
}

/**
 * The relative change of `withValue` against `withoutValue`. Returns the `n/a`
 * delta when the baseline is zero (or the inputs are not finite): the
 * "division by zero ⇒ show n/a" rule.
 */
export function relativeDelta(
    withValue: number,
    withoutValue: number,
    direction: Direction,
    unit: DeltaUnit = "percent",
): Delta {
    if (
        !Number.isFinite(withValue) ||
        !Number.isFinite(withoutValue) ||
        withoutValue === 0
    ) {
        return UNAVAILABLE_DELTA;
    }
    const value =
        unit === "percent"
            ? ((withValue - withoutValue) / withoutValue) * 100
            : (withValue - withoutValue) * 100;
    return { value, available: true, ...deltaFromValue(value, direction, unit) };
}

/** A paired change across cells: the median plus the observed min–max. */
export interface PairedChange {
    readonly median: number;
    readonly min: number;
    readonly max: number;
    /** How many cells contributed a finite change. */
    readonly samples: number;
    readonly unit: DeltaUnit;
    readonly direction: Direction;
}

/**
 * Computes each matched cell's with-vs-without change for `metric`, then the
 * median and the min–max across cells. Cells whose baseline is zero are
 * skipped: they have no relative change to report.
 */
export function pairedChange(
    index: CellIndex,
    select: (cell: CellKey) => boolean,
    metric: Metric,
    direction: Direction,
    unit: DeltaUnit,
): PairedChange {
    const values: number[] = [];
    for (const cell of index.matched.filter(select)) {
        const withMean = mean(runsFor(index, cell, "with").map(metric));
        const withoutMean = mean(runsFor(index, cell, "without").map(metric));
        if (withoutMean === 0) {
            continue;
        }
        values.push(
            unit === "percent"
                ? ((withMean - withoutMean) / withoutMean) * 100
                : (withMean - withoutMean) * 100,
        );
    }
    return {
        median: values.length === 0 ? Number.NaN : median(values),
        min: values.length === 0 ? Number.NaN : Math.min(...values),
        max: values.length === 0 ? Number.NaN : Math.max(...values),
        samples: values.length,
        unit,
        direction,
    };
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

/** The one-line "N matched cells, M runs" summary used in reports and charts. */
export function matchedSummary(index: CellIndex): string {
    const cells = index.matched.length;
    const runs = index.matchedRuns.length;
    return `${cells} matched ${cells === 1 ? "cell" : "cells"}, ${runs} ${runs === 1 ? "run" : "runs"}`;
}

/** Rows for the excluded-runs table, one per unmatched run. */
function excludedRows(index: CellIndex): readonly (readonly string[])[] {
    return [...index.excluded]
        .sort((left, right) => {
            const byProject = left.project.localeCompare(right.project);
            if (byProject !== 0) {
                return byProject;
            }
            const byModel = left.model.localeCompare(right.model);
            if (byModel !== 0) {
                return byModel;
            }
            const byMode = left.mode.localeCompare(right.mode);
            return byMode !== 0 ? byMode : left.runId.localeCompare(right.runId);
        })
        .map((record) => [record.project, record.model, record.mode, record.runId]);
}

/** One row per matched cell: the project × model table for RESULTS.md. */
function cellRows(index: CellIndex): readonly (readonly string[])[] {
    return index.matched.map((cell) => {
        const withoutRuns = runsFor(index, cell, "without");
        const withRuns = runsFor(index, cell, "with");
        const select = (candidate: CellKey) => cellId(candidate) === cellId(cell);
        const cost = pairedChange(index, select, costMetric, "lower", "percent");
        const time = pairedChange(index, select, wallMetric, "lower", "percent");
        return [
            cell.project,
            displayName(cell.model),
            String(withoutRuns.length),
            String(withRuns.length),
            formatPercent(mean(withoutRuns.map(successMetric))),
            formatPercent(mean(withRuns.map(successMetric))),
            cost.samples === 0 ? "n/a" : formatDelta(cost.median, cost.unit),
            time.samples === 0 ? "n/a" : formatDelta(time.median, time.unit),
        ];
    });
}

/** The body of `bench/RESULTS.md`; nothing is compared unless cells match. */
export function renderReport(
    records: readonly RunRecord[],
    title = "bashlight benchmark results",
): string {
    const index = matchCells(records);
    const lines: string[] = [`# ${title}`, ""];
    if (index.matched.length === 0) {
        lines.push(
            `No matched cells: none of the ${records.length} runs shares a (project, model) cell across both modes, so there is nothing to compare.`,
            "",
        );
    } else {
        const matched = index.matchedRuns;
        const successes = matched.filter((record) => record.success).length;
        const totalCost = matched.reduce((sum, record) => sum + record.costUsd, 0);
        lines.push(
            `Matched cells: ${index.matched.length} · Runs: ${matched.length} · Success: ${successes}/${matched.length} · Total cost: ${formatCost(totalCost)}`,
            "",
            "Only matched cells count: a cell is included when it has a completed run in both modes.",
            "",
            "Every column except `Cells` and `Runs` is an equal-weight mean over cells.",
            "",
            "## By cell (project × model)",
            "",
            ...table(
                [
                    "Project",
                    "Model",
                    "Runs w/o",
                    "Runs with",
                    "Success w/o",
                    "Success with",
                    "Δ cost",
                    "Δ time",
                ],
                cellRows(index),
                [2, 3, 4, 5, 6, 7],
            ),
            "",
            "## By model",
            "",
            ...table(
                [
                    "Model",
                    "Mode",
                    "Cells",
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
                aggregate(index).map((row) => [
                    row.model,
                    row.mode,
                    String(row.cells),
                    String(row.runs),
                    formatPercent(row.successRate),
                    formatInteger(row.input),
                    formatInteger(row.output),
                    formatCost(row.costUsd),
                    formatSeconds(row.wallSeconds),
                    formatSeconds(row.shellCalls),
                    formatSeconds(row.failedShellCalls),
                    formatSeconds(row.rewrites),
                    formatSeconds(row.lastGreenSeconds),
                ]),
                [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
            ),
            "",
            "## By project",
            "",
            ...table(
                [
                    "Project",
                    "Mode",
                    "Cells",
                    "Runs",
                    "Success",
                    "Cost",
                    "Wall (s)",
                    "Shell fail",
                    "Rewrites",
                    "Green (s)",
                ],
                aggregateByProject(index).map((row) => [
                    row.project,
                    row.mode,
                    String(row.cells),
                    String(row.runs),
                    formatPercent(row.successRate),
                    formatCost(row.costUsd),
                    formatSeconds(row.wallSeconds),
                    formatSeconds(row.failedShellCalls),
                    formatSeconds(row.rewrites),
                    formatSeconds(row.lastGreenSeconds),
                ]),
                [2, 3, 4, 5, 6, 7, 8, 9],
            ),
            "",
        );
    }
    if (index.excluded.length > 0) {
        lines.push(
            "## Excluded (unmatched)",
            "",
            `${index.excluded.length} unmatched run(s) are excluded from every comparison above.`,
            "",
            ...table(["Project", "Model", "Mode", "Run ID"], excludedRows(index), []),
        );
    }
    return `${lines.join("\n")}\n`;
}
