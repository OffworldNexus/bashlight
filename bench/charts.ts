/* eslint-disable sonarjs/function-return-type -- a bar is undefined when a group has no records */
/**
 * `bun bench/charts.ts [results.jsonl…]` — render the benchmark SVG charts.
 *
 * The charts are generated from the same records as `RESULTS.md`: success,
 * cost, wall time and failed shell calls by model, plus a per-project
 * success/cost chart. They are written into `docs/assets/benchmark/` and are
 * committed, so the documentation builds without running the benchmark. The
 * renderer itself is in `lib/chart.ts` and has no dependencies.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";

import type { ChartBar, ChartCategory, ChartSeries, ChartSpec } from "./lib/chart.ts";
import { renderChart } from "./lib/chart.ts";
import type { BenchFileSystem } from "./lib/fs.ts";
import { NodeBenchFileSystem } from "./lib/fs.ts";
import { mergeRecords } from "./lib/report.ts";
import { parseResults } from "./lib/results-store.ts";
import type { Mode, RunRecord } from "./lib/types.ts";

export const WITHOUT_COLOR = "#f59e0b";
export const WITH_COLOR = "#3b82f6";

/** The series, in the order the bars appear. */
export const SERIES: readonly ChartSeries[] = [
    { name: "without", color: WITHOUT_COLOR },
    { name: "with", color: WITH_COLOR },
];

/** A model id without its provider prefixes, e.g. `deepseek-v4.1-flash`. */
export function shortModel(model: string): string {
    const parts = model.split("/");
    return parts[parts.length - 1] ?? model;
}

function mean(values: readonly number[]): number {
    return values.length === 0
        ? 0
        : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Mean with a min–max whisker, or `undefined` when there are no records. */
function bar(values: readonly number[]): ChartBar | undefined {
    if (values.length === 0) {
        return undefined;
    }
    return { value: mean(values), min: Math.min(...values), max: Math.max(...values) };
}

function grouped(
    records: readonly RunRecord[],
    key: (record: RunRecord) => string,
): Map<string, RunRecord[]> {
    const map = new Map<string, RunRecord[]>();
    for (const record of records) {
        const bucket = map.get(key(record));
        if (bucket === undefined) {
            map.set(key(record), [record]);
        } else {
            bucket.push(record);
        }
    }
    return map;
}

/** Sorted, unique model ids present in the records. */
export function models(records: readonly RunRecord[]): readonly string[] {
    return [...new Set(records.map((record) => record.model))].sort((a, b) =>
        a.localeCompare(b),
    );
}

/** Sorted, unique project names present in the records. */
export function projects(records: readonly RunRecord[]): readonly string[] {
    return [...new Set(records.map((record) => record.project))].sort((a, b) =>
        a.localeCompare(b),
    );
}

type Metric = (record: RunRecord) => number;

/** Builds categories of `[without, with]` bars for each key. */
function categoriesFor(
    records: readonly RunRecord[],
    keyOf: (record: RunRecord) => string,
    keys: readonly string[],
    metric: Metric,
): readonly ChartCategory[] {
    const buckets = grouped(records, keyOf);
    return keys.map((key) => {
        const bucket = buckets.get(key) ?? [];
        const values = SERIES.map((series) => {
            const mode = series.name as Mode;
            return bar(bucket.filter((record) => record.mode === mode).map(metric));
        });
        return {
            label: key,
            values: values.map((value) => value ?? { value: 0 }),
        } satisfies ChartCategory;
    });
}

/** Rescales a percentage-ish category's value, min and max. */
function percentCategory(category: ChartCategory): ChartCategory {
    return {
        label: category.label,
        values: category.values.map((value) => ({
            value: value.value * 100,
            ...(value.min === undefined ? {} : { min: value.min * 100 }),
            ...(value.max === undefined ? {} : { max: value.max * 100 }),
        })),
    };
}

const successMetric: Metric = (record) => (record.success ? 1 : 0);
const costMetric: Metric = (record) => record.costUsd;
const wallMetric: Metric = (record) => record.wallMs / 1000;
const failedMetric: Metric = (record) => record.failedShellCalls;

/** Success rate by model, in percent. */
export function successByModel(records: readonly RunRecord[]): ChartSpec {
    const keys = models(records);
    return {
        title: "Task success rate by model",
        series: SERIES,
        panels: [
            {
                yLabel: "Success",
                categories: categoriesFor(
                    records,
                    (record) => record.model,
                    keys,
                    successMetric,
                ).map((category) => ({
                    ...percentCategory(category),
                    label: shortModel(category.label),
                })),
                format: (value) => `${value.toFixed(0)}%`,
            },
        ],
    };
}

/** Mean cost per run by model, in US dollars. */
export function costByModel(records: readonly RunRecord[]): ChartSpec {
    return {
        title: "Mean cost per run by model",
        series: SERIES,
        panels: [
            {
                yLabel: "Cost (USD)",
                categories: categoriesFor(
                    records,
                    (record) => record.model,
                    models(records),
                    costMetric,
                ).map((category) => ({
                    ...category,
                    label: shortModel(category.label),
                })),
                format: (value) => `$${value.toFixed(3)}`,
            },
        ],
    };
}

/** Mean wall time per run by model, in seconds. */
export function timeByModel(records: readonly RunRecord[]): ChartSpec {
    return {
        title: "Mean wall time per run by model",
        series: SERIES,
        panels: [
            {
                yLabel: "Seconds",
                categories: categoriesFor(
                    records,
                    (record) => record.model,
                    models(records),
                    wallMetric,
                ).map((category) => ({
                    ...category,
                    label: shortModel(category.label),
                })),
                format: (value) => `${value.toFixed(0)}s`,
            },
        ],
    };
}

/** Mean failed shell calls per run by model. */
export function failedShellsByModel(records: readonly RunRecord[]): ChartSpec {
    return {
        title: "Mean failed shell calls per run by model",
        series: SERIES,
        panels: [
            {
                yLabel: "Failed calls",
                categories: categoriesFor(
                    records,
                    (record) => record.model,
                    models(records),
                    failedMetric,
                ).map((category) => ({
                    ...category,
                    label: shortModel(category.label),
                })),
                format: (value) => value.toFixed(1),
            },
        ],
    };
}

/** Per-project success rate and cost, as two stacked panels. */
export function projectChart(records: readonly RunRecord[]): ChartSpec {
    const keys = projects(records);
    const success = categoriesFor(
        records,
        (record) => record.project,
        keys,
        successMetric,
    ).map(percentCategory);
    const cost = categoriesFor(records, (record) => record.project, keys, costMetric);
    return {
        title: "Success rate and cost by project",
        series: SERIES,
        panels: [
            {
                title: "Success rate",
                yLabel: "Success",
                categories: success,
                format: (value) => `${value.toFixed(0)}%`,
            },
            {
                title: "Mean cost per run",
                yLabel: "Cost (USD)",
                categories: cost,
                format: (value) => `$${value.toFixed(3)}`,
            },
        ],
    };
}

/** The five charts and the file each is written to. */
export function chartFiles(
    records: readonly RunRecord[],
): readonly { readonly name: string; readonly spec: ChartSpec }[] {
    return [
        { name: "success-by-model.svg", spec: successByModel(records) },
        { name: "cost-by-model.svg", spec: costByModel(records) },
        { name: "time-by-model.svg", spec: timeByModel(records) },
        { name: "failed-shells-by-model.svg", spec: failedShellsByModel(records) },
        { name: "project-success-cost.svg", spec: projectChart(records) },
    ];
}

/** Renders every chart into `directory`, returning the written file names. */
export function writeCharts(
    records: readonly RunRecord[],
    directory: string,
    fs: BenchFileSystem,
): readonly string[] {
    fs.mkdirp(directory);
    const written: string[] = [];
    for (const { name, spec } of chartFiles(records)) {
        fs.writeFile(join(directory, name), `${renderChart(spec)}\n`);
        written.push(name);
    }
    return written;
}

/** The default location of the generated charts, relative to the repo root. */
export function chartsDirectory(repoRoot: string): string {
    return join(repoRoot, "docs", "assets", "benchmark");
}

/** Reads and merges one or more results files. */
export function readRecords(
    files: readonly string[],
    fs: BenchFileSystem,
): readonly RunRecord[] {
    return mergeRecords(files.map((file) => parseResults(fs.readFile(file) ?? "")));
}

// `bun bench/charts.ts [files…]` writes the charts for the given results.
if (import.meta.main) {
    const fs = new NodeBenchFileSystem();
    const benchDir = import.meta.dirname;
    const repoRoot = join(benchDir, "..");
    const args = process.argv.slice(2);
    const files =
        args.length > 0
            ? args
            : readdirSync(join(benchDir, "results"))
                  .filter((name) => name.endsWith(".jsonl"))
                  .map((name) => join(benchDir, "results", name));
    const records = readRecords(files, fs);
    const written = writeCharts(records, chartsDirectory(repoRoot), fs);
    process.stdout.write(
        `wrote ${written.length} charts from ${records.length} runs\n`,
    );
}
