import { describe, expect, test } from "bun:test";

import { aggregate, renderReport } from "../../bench/lib/report.ts";
import type { RunRecord } from "../../bench/lib/types.ts";

function record(overrides: Partial<RunRecord>): RunRecord {
    return {
        runId: "run",
        timestamp: "2026-01-01T00:00:00.000Z",
        project: "poetry-shop",
        mode: "with",
        model: "openrouter/deepseek/deepseek-v4.1-flash",
        success: true,
        detail: "",
        wallMs: 10_000,
        tokens: { input: 100, output: 20, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
        costUsd: 0.01,
        toolCalls: 5,
        shellCalls: 4,
        failedShellCalls: 1,
        rewrites: 2,
        blocks: 0,
        ...overrides,
    };
}

describe("aggregate", () => {
    test("groups by model and mode and averages per-run figures", () => {
        const rows = aggregate([
            record({ mode: "with", success: true, wallMs: 10_000, costUsd: 0.01 }),
            record({ mode: "with", success: false, wallMs: 30_000, costUsd: 0.03 }),
            record({ mode: "without", success: false, wallMs: 20_000, costUsd: 0.02 }),
        ]);
        expect(rows).toHaveLength(2);
        const withRow = rows.find((row) => row.mode === "with");
        const withoutRow = rows.find((row) => row.mode === "without");
        expect(withRow?.runs).toBe(2);
        expect(withRow?.successRate).toBe(0.5);
        expect(withRow?.meanCostUsd).toBeCloseTo(0.02, 10);
        expect(withRow?.meanWallSeconds).toBeCloseTo(20, 10);
        expect(withoutRow?.successRate).toBe(0);
        expect(withoutRow?.meanRewrites).toBe(2);
    });

    test("orders without before with", () => {
        const rows = aggregate([record({ mode: "with" }), record({ mode: "without" })]);
        expect(rows.map((row) => row.mode)).toEqual(["without", "with"]);
    });
});

describe("renderReport", () => {
    test("renders a markdown table with a row per model and mode", () => {
        const markdown = renderReport([
            record({ model: "m1", mode: "with" }),
            record({ model: "m1", mode: "without" }),
            record({ model: "m2", mode: "with" }),
        ]);
        expect(markdown).toContain("| Model | Mode |");
        expect(markdown).toContain("| m1 | without |");
        expect(markdown).toContain("| m1 | with |");
        expect(markdown).toContain("| m2 | with |");
        expect(markdown).toContain("Runs: 3");
    });

    test("handles an empty result set", () => {
        expect(renderReport([])).toContain("Runs: 0");
    });
});
