#!/usr/bin/env bun
/**
 * `bun bench/report.ts [results.jsonl]` — render benchmark results.
 *
 * With no argument the newest file under `bench/results/` is used. The
 * Markdown table is printed and written to `bench/RESULTS.md` so the summary
 * can be committed while the raw runs stay ignored.
 */

import { join } from "node:path";

import { NodeBenchFileSystem } from "./lib/fs.ts";
import { renderReport } from "./lib/report.ts";
import { parseResults } from "./lib/results-store.ts";

function newestResultsFile(
    fs: NodeBenchFileSystem,
    directory: string,
): string | undefined {
    const files = fs
        .readDirectory(directory)
        .filter((name) => name.endsWith(".jsonl"))
        .sort((left, right) => left.localeCompare(right));
    const newest = files.at(-1);
    return newest === undefined ? undefined : join(directory, newest);
}

function main(): number {
    const benchDir = import.meta.dirname;
    const fs = new NodeBenchFileSystem();
    const path = process.argv[2] ?? newestResultsFile(fs, join(benchDir, "results"));
    if (path === undefined) {
        process.stderr.write("no results file found; run `bun bench/run.ts` first\n");
        return 1;
    }
    const records = parseResults(fs.readFile(path) ?? "");
    const markdown = renderReport(records);
    const destination = join(benchDir, "RESULTS.md");
    fs.writeFile(destination, markdown);
    process.stdout.write(markdown);
    process.stdout.write(`\nwritten to ${destination}\n`);
    return 0;
}

process.exit(main());
