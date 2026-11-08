#!/usr/bin/env bun
/**
 * `bun bench/report.ts [--all] [--all-charts] [results.jsonl…]` — render the
 * benchmark outputs.
 *
 * Writes `bench/RESULTS.md` (matched cells only), `bench/HEADLINES.json` (the
 * numbers behind the two page messages), and the two headline charts into
 * `docs/assets/benchmark/`. `--all-charts` additionally writes the exploratory
 * charts into `bench/charts/`; `--all` merges every results file. With no
 * matched cells nothing is charted and the summary says so.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";

import {
    chartsDirectory,
    scratchChartsDirectory,
    writeHeadlineCharts,
    writeOtherCharts,
} from "./charts.ts";
import { NodeBenchFileSystem } from "./lib/fs.ts";
import { buildHeadlines, headlinesDocument } from "./lib/headlines.ts";
import {
    matchCells,
    matchedSummary,
    mergeRecords,
    renderReport,
} from "./lib/report.ts";
import { parseResults } from "./lib/results-store.ts";

function resultsFiles(directory: string): readonly string[] {
    return readdirSync(directory)
        .filter((name) => name.endsWith(".jsonl"))
        .sort((left, right) => left.localeCompare(right))
        .map((name) => join(directory, name));
}

function main(): number {
    const benchDir = import.meta.dirname;
    const repoRoot = join(benchDir, "..");
    const fs = new NodeBenchFileSystem();
    const args = process.argv.slice(2);
    const mergeAll = args.some((arg) => arg === "--all");
    const allCharts = args.some((arg) => arg === "--all-charts");
    const explicit = args.filter((arg) => !arg.startsWith("--"));
    const available = resultsFiles(join(benchDir, "results"));
    let files: readonly string[];
    if (explicit.length > 0) {
        files = explicit;
    } else if (mergeAll) {
        files = available;
    } else {
        files = available.slice(-1);
    }
    if (files.length === 0) {
        process.stderr.write("no results file found; run `bun bench/run.ts` first\n");
        return 1;
    }

    const records = mergeRecords(
        files.map((file) => parseResults(fs.readFile(file) ?? "")),
    );
    const index = matchCells(records);

    const summaryPath = join(benchDir, "RESULTS.md");
    fs.writeFile(summaryPath, renderReport(records));

    const headlinesPath = join(benchDir, "HEADLINES.json");
    fs.writeFile(
        headlinesPath,
        `${JSON.stringify(headlinesDocument(buildHeadlines(index)), null, 4)}\n`,
    );

    const charts =
        index.matched.length === 0
            ? []
            : writeHeadlineCharts(records, chartsDirectory(repoRoot), fs);
    const extra = allCharts
        ? writeOtherCharts(records, scratchChartsDirectory(repoRoot), fs)
        : [];

    process.stdout.write(
        `\n${matchedSummary(index)}\n` +
            `written: ${summaryPath}, ${headlinesPath}` +
            (index.matched.length === 0
                ? " (no charts: no matched cells)\n"
                : ` and ${charts.length} headline charts in ${chartsDirectory(repoRoot)}\n`) +
            (allCharts
                ? `plus ${extra.length} exploratory charts in ${scratchChartsDirectory(repoRoot)}\n`
                : "") +
            `from ${records.length} runs in ${files.length} file(s)\n`,
    );
    return 0;
}

process.exit(main());
