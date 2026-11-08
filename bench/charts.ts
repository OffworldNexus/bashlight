/* eslint-disable sonarjs/function-return-type -- a bar is undefined when a group has no records */
/**
 * `bun bench/charts.ts [--all-charts] [results.jsonl…]` — render the benchmark
 * SVGs.
 *
 * The page carries two headline charts and nothing else: `headline-cost-time`
 * (flash-class models, paired median change in cost and wall time) and
 * `headline-completion` (completion with vs without, models smallest first).
 * Everything is built from **matched cells** via `lib/headlines.ts`, so the
 * charts, `HEADLINES.json` and `RESULTS.md` cannot disagree.
 *
 * The older exploratory charts are kept out of the docs; pass `--all-charts`
 * to write them into `bench/charts/` instead.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";

import type {
    ChartBar,
    ChartCategory,
    ChartSeries,
    ChartSpec,
    DeltaBar,
    DeltaCategory,
    DeltaChartSpec,
} from "./lib/chart.ts";
import { renderChart, renderDeltaChart } from "./lib/chart.ts";
import type { BenchFileSystem } from "./lib/fs.ts";
import { NodeBenchFileSystem } from "./lib/fs.ts";
import { buildHeadlines } from "./lib/headlines.ts";
import { shortModel } from "./lib/models.ts";
import {
    type CellIndex,
    cellMeans,
    costMetric,
    deltaFromValue,
    failedMetric,
    matchCells,
    matchedSummary,
    mean,
    mergeRecords,
    type Metric,
    modelsIn,
    type PairedChange,
    pairedChange,
    projectsIn,
    successMetric,
    UNAVAILABLE_DELTA,
    wallMetric,
} from "./lib/report.ts";
import { parseResults } from "./lib/results-store.ts";
import type { Mode, RunRecord } from "./lib/types.ts";

export const WITHOUT_COLOR = "#f59e0b";
export const WITH_COLOR = "#3b82f6";

/** The series, in the order the bars appear. */
export const SERIES: readonly ChartSeries[] = [
    { name: "without", color: WITHOUT_COLOR },
    { name: "with", color: WITH_COLOR },
];

export { shortModel };

/**
 * Mean of the per-cell means, with a min–max whisker across cells only when
 * there are at least two cells: one cell has no spread to show.
 */
function bar(values: readonly number[]): ChartBar | undefined {
    if (values.length === 0) {
        return undefined;
    }
    if (values.length === 1) {
        return { value: mean(values) };
    }
    return { value: mean(values), min: Math.min(...values), max: Math.max(...values) };
}

/** Builds `[without, with]` bars for each key, equal-weighted over cells. */
function categoriesFor(
    index: CellIndex,
    keyOf: (cell: { readonly project: string; readonly model: string }) => string,
    keys: readonly string[],
    metric: Metric,
): readonly ChartCategory[] {
    return keys.map((key) => {
        const values = SERIES.map((series) =>
            bar(
                cellMeans(
                    index,
                    (cell) => keyOf(cell) === key,
                    series.name as Mode,
                    metric,
                ),
            ),
        );
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

/** A paired change drawn as a delta bar (median + optional whisker). */
function deltaBar(change: PairedChange): DeltaBar {
    if (change.samples === 0) {
        return UNAVAILABLE_DELTA;
    }
    return {
        value: change.median,
        available: true,
        ...deltaFromValue(change.median, change.direction, change.unit),
        ...(change.samples >= 2 ? { min: change.min, max: change.max } : {}),
    };
}

/** Message 1: cost and wall-time change, flash-class models only. */
export function headlineCostTime(index: CellIndex): DeltaChartSpec {
    return {
        title: "Cost and time change, flash-class models",
        subtitle: matchedSummary(index),
        metrics: ["cost / run", "wall time"],
        categories: buildHeadlines(index).costTime.map((headline) => ({
            label: headline.display,
            bars: [deltaBar(headline.cost), deltaBar(headline.time)],
        })),
    };
}

/** Message 2: completion with vs without, every model, smallest first. */
export function headlineCompletion(index: CellIndex): ChartSpec {
    const headlines = buildHeadlines(index);
    const models = headlines.completion.map((headline) => headline.model);
    const categories = categoriesFor(index, (cell) => cell.model, models, successMetric)
        .map(percentCategory)
        .map((category, position) => ({
            ...category,
            label:
                headlines.completion[position]?.display ?? shortModel(category.label),
        }));
    return {
        title: "Completion rate by model",
        subtitle: matchedSummary(index),
        series: SERIES,
        panels: [
            {
                yLabel: "Success",
                categories,
                format: (value) => `${value.toFixed(0)}%`,
            },
        ],
    };
}

/** Success rate by model, in percent. */
function successByModel(index: CellIndex): ChartSpec {
    const categories = categoriesFor(
        index,
        (cell) => cell.model,
        modelsIn(index),
        successMetric,
    ).map((category) => ({
        ...percentCategory(category),
        label: shortModel(category.label),
    }));
    return {
        title: "Task success rate by model",
        series: SERIES,
        panels: [
            {
                yLabel: "Success",
                categories,
                format: (value) => `${value.toFixed(0)}%`,
            },
        ],
    };
}

/** Mean cost per run by model, in US dollars. */
function costByModel(index: CellIndex): ChartSpec {
    return {
        title: "Mean cost per run by model",
        series: SERIES,
        panels: [
            {
                yLabel: "Cost (USD)",
                categories: categoriesFor(
                    index,
                    (cell) => cell.model,
                    modelsIn(index),
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
function timeByModel(index: CellIndex): ChartSpec {
    return {
        title: "Mean wall time per run by model",
        series: SERIES,
        panels: [
            {
                yLabel: "Seconds",
                categories: categoriesFor(
                    index,
                    (cell) => cell.model,
                    modelsIn(index),
                    wallMetric,
                ).map((category) => ({
                    ...category,
                    label: shortModel(category.label),
                })),
                format: (value) => `${value.toFixed(0)} s`,
            },
        ],
    };
}

/** Mean failed shell calls per run by model. */
function failedShellsByModel(index: CellIndex): ChartSpec {
    return {
        title: "Mean failed shell calls per run by model",
        series: SERIES,
        panels: [
            {
                yLabel: "Failed calls",
                categories: categoriesFor(
                    index,
                    (cell) => cell.model,
                    modelsIn(index),
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
function projectChart(index: CellIndex): ChartSpec {
    const success = categoriesFor(
        index,
        (cell) => cell.project,
        projectsIn(index),
        successMetric,
    ).map(percentCategory);
    const cost = categoriesFor(
        index,
        (cell) => cell.project,
        projectsIn(index),
        costMetric,
    );
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

interface DeltaMetricDefinition {
    readonly name: string;
    readonly metric: Metric;
    readonly direction: "lower" | "higher";
    readonly unit: "percent" | "points";
}

const DELTA_METRICS: readonly DeltaMetricDefinition[] = [
    { name: "cost", metric: costMetric, direction: "lower", unit: "percent" },
    { name: "wall time", metric: wallMetric, direction: "lower", unit: "percent" },
    {
        name: "failed shells",
        metric: failedMetric,
        direction: "lower",
        unit: "percent",
    },
    { name: "success", metric: successMetric, direction: "higher", unit: "points" },
];

/** One bar per metric per key, from the paired per-cell deltas. */
function deltaCategories(
    index: CellIndex,
    keyOf: (cell: { readonly project: string; readonly model: string }) => string,
    keys: readonly string[],
): readonly DeltaCategory[] {
    return keys.map((key) => ({
        label: key,
        bars: DELTA_METRICS.map((definition) =>
            deltaBar(
                pairedChange(
                    index,
                    (cell) => keyOf(cell) === key,
                    definition.metric,
                    definition.direction,
                    definition.unit,
                ),
            ),
        ),
    }));
}

/** Delta (with vs without) by model. */
function deltaByModel(index: CellIndex): DeltaChartSpec {
    return {
        title: "Change with bashlight, by model",
        metrics: DELTA_METRICS.map((definition) => definition.name),
        categories: deltaCategories(index, (cell) => cell.model, modelsIn(index)).map(
            (category) => ({ ...category, label: shortModel(category.label) }),
        ),
    };
}

/** Delta (with vs without) by project, aggregated over models. */
function deltaByProject(index: CellIndex): DeltaChartSpec {
    return {
        title: "Change with bashlight, by project",
        metrics: DELTA_METRICS.map((definition) => definition.name),
        categories: deltaCategories(index, (cell) => cell.project, projectsIn(index)),
    };
}

/** One chart and how to render it. */
export interface ChartFile {
    readonly name: string;
    readonly render: () => string;
}

/** The two headline charts, with the file each is written to. */
export function headlineChartFiles(index: CellIndex): readonly ChartFile[] {
    return [
        {
            name: "headline-cost-time.svg",
            render: () => renderDeltaChart(headlineCostTime(index)),
        },
        {
            name: "headline-completion.svg",
            render: () => renderChart(headlineCompletion(index)),
        },
    ];
}

/** The exploratory charts, kept out of the docs page. */
export function otherChartFiles(index: CellIndex): readonly ChartFile[] {
    return [
        {
            name: "delta-by-model.svg",
            render: () => renderDeltaChart(deltaByModel(index)),
        },
        {
            name: "success-by-model.svg",
            render: () => renderChart(successByModel(index)),
        },
        { name: "cost-by-model.svg", render: () => renderChart(costByModel(index)) },
        { name: "time-by-model.svg", render: () => renderChart(timeByModel(index)) },
        {
            name: "failed-shells-by-model.svg",
            render: () => renderChart(failedShellsByModel(index)),
        },
        {
            name: "project-success-cost.svg",
            render: () => renderChart(projectChart(index)),
        },
        {
            name: "delta-by-project.svg",
            render: () => renderDeltaChart(deltaByProject(index)),
        },
    ];
}

/** Renders files into `directory`, returning the written names. */
function writeFiles(
    files: readonly ChartFile[],
    directory: string,
    fs: BenchFileSystem,
): readonly string[] {
    if (files.length === 0) {
        return [];
    }
    fs.mkdirp(directory);
    const written: string[] = [];
    for (const file of files) {
        fs.writeFile(join(directory, file.name), `${file.render()}\n`);
        written.push(file.name);
    }
    return written;
}

/**
 * Writes the two headline charts. With no matched cells nothing is written:
 * there is no comparison to draw.
 */
export function writeHeadlineCharts(
    records: readonly RunRecord[],
    directory: string,
    fs: BenchFileSystem,
): readonly string[] {
    const index = matchCells(records);
    return index.matched.length === 0
        ? []
        : writeFiles(headlineChartFiles(index), directory, fs);
}

/** Writes the exploratory charts (only with `--all-charts`). */
export function writeOtherCharts(
    records: readonly RunRecord[],
    directory: string,
    fs: BenchFileSystem,
): readonly string[] {
    const index = matchCells(records);
    return index.matched.length === 0
        ? []
        : writeFiles(otherChartFiles(index), directory, fs);
}

/** The default location of the generated headline charts. */
export function chartsDirectory(repoRoot: string): string {
    return join(repoRoot, "docs", "assets", "benchmark");
}

/** Where the exploratory charts go when asked for. */
export function scratchChartsDirectory(repoRoot: string): string {
    return join(repoRoot, "bench", "charts");
}

/** Reads and merges one or more results files. */
export function readRecords(
    files: readonly string[],
    fs: BenchFileSystem,
): readonly RunRecord[] {
    return mergeRecords(files.map((file) => parseResults(fs.readFile(file) ?? "")));
}

// `bun bench/charts.ts [--all-charts] [files…]` writes the charts.
if (import.meta.main) {
    const fs = new NodeBenchFileSystem();
    const benchDir = import.meta.dirname;
    const repoRoot = join(benchDir, "..");
    const args = process.argv.slice(2);
    const allCharts = args.some((arg) => arg === "--all-charts");
    const files = args.filter((arg) => !arg.startsWith("--"));
    const sources =
        files.length > 0
            ? files
            : readdirSync(join(benchDir, "results"))
                  .filter((name) => name.endsWith(".jsonl"))
                  .map((name) => join(benchDir, "results", name));
    const records = readRecords(sources, fs);
    const headlines = writeHeadlineCharts(records, chartsDirectory(repoRoot), fs);
    const extra = allCharts
        ? writeOtherCharts(records, scratchChartsDirectory(repoRoot), fs)
        : [];
    if (headlines.length === 0) {
        process.stdout.write(
            `no matched cells in ${records.length} runs; wrote no charts\n`,
        );
    } else if (allCharts) {
        process.stdout.write(
            `wrote ${headlines.length} headline charts and ${extra.length} exploratory charts from ${records.length} runs\n`,
        );
    } else {
        process.stdout.write(
            `wrote ${headlines.length} headline charts from ${records.length} runs\n`,
        );
    }
}
