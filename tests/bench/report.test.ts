import { describe, expect, test } from "bun:test";

import { writeHeadlineCharts } from "../../bench/charts.ts";
import type { BenchFileSystem } from "../../bench/lib/fs.ts";
import {
    aggregate,
    matchCells,
    median,
    pairedChange,
    relativeDelta,
    renderReport,
} from "../../bench/lib/report.ts";
import type { RunRecord } from "../../bench/lib/types.ts";

function record(overrides: Partial<RunRecord>): RunRecord {
    return {
        runId: "run",
        timestamp: "2026-01-01T00:00:00.000Z",
        project: "p1",
        mode: "with",
        model: "openrouter/deepseek/deepseek-v4.1-flash",
        success: true,
        detail: "",
        wallMs: 10_000,
        tokens: { input: 1000, output: 100, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
        costUsd: 0.01,
        toolCalls: 5,
        shellCalls: 4,
        failedShellCalls: 1,
        rewrites: 1,
        blocks: 0,
        ...overrides,
    };
}

class MemoryFileSystem implements BenchFileSystem {
    readonly files = new Map<string, string>();

    mkdirp(): void {}

    writeFile(path: string, content: string): void {
        this.files.set(path, content);
    }

    readFile(path: string): string | undefined {
        return this.files.get(path);
    }

    exists(path: string): boolean {
        return this.files.has(path);
    }

    isDirectory(): boolean {
        return false;
    }

    readDirectory(): readonly string[] {
        return [];
    }

    copyTree(): void {}

    remove(path: string): void {
        this.files.delete(path);
    }
}

describe("matchCells", () => {
    test("keeps only cells with a run in both modes", () => {
        const index = matchCells([
            record({ runId: "a1", project: "p1", model: "m1", mode: "with" }),
            record({ runId: "a2", project: "p1", model: "m1", mode: "without" }),
            record({ runId: "b1", project: "p1", model: "m2", mode: "with" }),
            record({ runId: "c1", project: "p2", model: "m1", mode: "without" }),
        ]);
        expect(index.matched.map((cell) => `${cell.project}/${cell.model}`)).toEqual([
            "p1/m1",
        ]);
        expect(index.matchedRuns.map((entry) => entry.runId)).toEqual(["a1", "a2"]);
        expect(index.excluded.map((entry) => entry.runId)).toEqual(["b1", "c1"]);
    });

    test("exposes the runs of each cell per mode", () => {
        const index = matchCells([
            record({ runId: "a1", project: "p1", model: "m1", mode: "with" }),
            record({ runId: "a2", project: "p1", model: "m1", mode: "without" }),
        ]);
        const id = "p1\u0000m1";
        expect(index.withRuns.get(id)?.length).toBe(1);
        expect(index.withoutRuns.get(id)?.length).toBe(1);
    });
});

describe("equal weighting", () => {
    test("averages per-cell means, so a long cell cannot dominate", () => {
        // p1/m1 has five runs averaging 0.10; p2/m1 has one run at 0.01.
        const runs: RunRecord[] = [
            ...Array.from({ length: 5 }, (_, index) =>
                record({
                    runId: `p1-${index}`,
                    project: "p1",
                    model: "m1",
                    mode: "with",
                    costUsd: 0.1,
                }),
            ),
            record({
                runId: "p1-w",
                project: "p1",
                model: "m1",
                mode: "without",
                costUsd: 0.2,
            }),
            record({
                runId: "p2-0",
                project: "p2",
                model: "m1",
                mode: "with",
                costUsd: 0.01,
            }),
            record({
                runId: "p2-w",
                project: "p2",
                model: "m1",
                mode: "without",
                costUsd: 0.02,
            }),
        ];
        const rows = aggregate(matchCells(runs));
        const withRow = rows.find((row) => row.model === "m1" && row.mode === "with");
        const withoutRow = rows.find(
            (row) => row.model === "m1" && row.mode === "without",
        );
        expect(withRow?.cells).toBe(2);
        // (0.10 + 0.01) / 2, not the run-weighted 0.0916…
        expect(withRow?.costUsd).toBeCloseTo(0.055, 10);
        expect(withoutRow?.costUsd).toBeCloseTo(0.11, 10);
        expect(withRow?.runs).toBe(6);
    });
});

describe("median", () => {
    test("returns the middle value", () => {
        expect(median([3, 1, 2])).toBe(2);
        expect(median([1, 2, 3, 4])).toBe(2.5);
        expect(median([])).toBe(0);
    });
});

describe("relativeDelta", () => {
    test("returns n/a instead of dividing by a zero baseline", () => {
        const delta = relativeDelta(1, 0, "lower");
        expect(delta.available).toBe(false);
        expect(delta.label).toBe("n/a");
    });

    test("formats and classifies a percentage change", () => {
        expect(relativeDelta(50, 100, "lower").label).toBe("−50%");
        expect(relativeDelta(50, 100, "lower").tone).toBe("better");
        expect(relativeDelta(150, 100, "lower").tone).toBe("worse");
    });
});

describe("pairedChange", () => {
    test("reports the median and min–max across cells", () => {
        // Cell A: without 0.02 → with 0.01 = −50%. Cell B: 0.01 → 0.02 = +100%.
        const index = matchCells([
            record({
                runId: "a1",
                project: "p1",
                model: "m1",
                mode: "with",
                costUsd: 0.01,
            }),
            record({
                runId: "a2",
                project: "p1",
                model: "m1",
                mode: "without",
                costUsd: 0.02,
            }),
            record({
                runId: "b1",
                project: "p2",
                model: "m1",
                mode: "with",
                costUsd: 0.02,
            }),
            record({
                runId: "b2",
                project: "p2",
                model: "m1",
                mode: "without",
                costUsd: 0.01,
            }),
        ]);
        const change = pairedChange(
            index,
            (cell) => cell.model === "m1",
            (entry) => entry.costUsd,
            "lower",
            "percent",
        );
        expect(change.samples).toBe(2);
        expect(change.median).toBeCloseTo(25, 10);
        expect(change.min).toBeCloseTo(-50, 10);
        expect(change.max).toBeCloseTo(100, 10);
    });
});

describe("renderReport", () => {
    test("states the matched summary and lists excluded runs", () => {
        const markdown = renderReport([
            record({ runId: "a1", project: "p1", model: "m1", mode: "with" }),
            record({ runId: "a2", project: "p1", model: "m1", mode: "without" }),
            record({ runId: "solo", project: "p2", model: "m1", mode: "without" }),
        ]);
        expect(markdown).toContain("Matched cells: 1 · Runs: 2");
        expect(markdown).toContain("## By cell (project × model)");
        expect(markdown).toContain("## Excluded (unmatched)");
        expect(markdown).toContain("solo");
    });

    test("says so explicitly when nothing matches", () => {
        const markdown = renderReport([
            record({ runId: "only", project: "p1", model: "m1", mode: "with" }),
        ]);
        expect(markdown).toContain("No matched cells");
        expect(markdown).toContain("## Excluded (unmatched)");
        expect(markdown).not.toContain("## By model");
    });
});

describe("harnessError exclusion", () => {
    test("a harness error is neither matched nor listed as unmatched", () => {
        const records = [
            record({ runId: "w", project: "p1", model: "m1", mode: "with" }),
            record({ runId: "wo", project: "p1", model: "m1", mode: "without" }),
            record({
                runId: "bad",
                project: "p2",
                model: "m1",
                mode: "with",
                success: false,
                harnessError: true,
                error: "ENOSPC: no space left on device",
            }),
        ];
        const index = matchCells(records);
        expect(index.matchedRuns.map((entry) => entry.runId)).toEqual(["w", "wo"]);
        expect(index.excluded).toHaveLength(0);
        const markdown = renderReport(records);
        expect(markdown).toContain("Matched cells: 1 · Runs: 2");
        expect(markdown).toContain("## Harness errors (excluded)");
        expect(markdown).toContain("ENOSPC");
    });
});

describe("writeHeadlineCharts", () => {
    test("writes nothing when there are no matched cells", () => {
        const fs = new MemoryFileSystem();
        const written = writeHeadlineCharts(
            [record({ project: "p1", model: "m1", mode: "with" })],
            "/charts",
            fs,
        );
        expect(written).toEqual([]);
        expect(fs.files.size).toBe(0);
    });

    test("writes both headline charts when cells match", () => {
        const fs = new MemoryFileSystem();
        const written = writeHeadlineCharts(
            [
                record({ runId: "a1", project: "p1", model: "m1", mode: "with" }),
                record({ runId: "a2", project: "p1", model: "m1", mode: "without" }),
            ],
            "/charts",
            fs,
        );
        expect(written).toEqual(["headline-cost-time.svg", "headline-completion.svg"]);
    });
});
