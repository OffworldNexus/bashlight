#!/usr/bin/env bun
/**
 * `bun bench/report.ts [results.jsonl…]` — render results and charts.
 *
 * With no argument the newest file under `bench/results/` is used; pass several
 * files (or `--all`) to merge them. The Markdown summary is written to
 * `bench/RESULTS.md` and the SVG charts to `docs/assets/benchmark/`, both
 * committed so the docs build without a benchmark run. The raw event logs under
 * `bench/runs/` stay ignored.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";

import { chartsDirectory, writeCharts } from "./charts.ts";
import { NodeBenchFileSystem } from "./lib/fs.ts";
import { mergeRecords, renderReport } from "./lib/report.ts";
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
    const all = args.some((arg) => arg === "--all");
    const explicit = args.filter((arg) => !arg.startsWith("--"));
    const available = resultsFiles(join(benchDir, "results"));
    let files: readonly string[];
    if (explicit.length > 0) {
        files = explicit;
    } else if (all) {
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
    const markdown = renderReport(records);
    const summaryPath = join(benchDir, "RESULTS.md");
    fs.writeFile(summaryPath, markdown);
    const charts = writeCharts(records, chartsDirectory(repoRoot), fs);
    process.stdout.write(markdown);
    process.stdout.write(
        `\nwritten: ${summaryPath} and ${charts.length} charts in ${chartsDirectory(repoRoot)}\n` +
            `from ${records.length} runs in ${files.length} file(s)\n`,
    );
    return 0;
}

process.exit(main());
