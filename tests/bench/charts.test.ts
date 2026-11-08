import { describe, expect, test } from "bun:test";

import { headlineCompletion, headlineCostTime } from "../../bench/charts.ts";
import { matchCells } from "../../bench/lib/report.ts";
import type { RunRecord } from "../../bench/lib/types.ts";

const NANO = "openrouter/openai/gpt-5-nano";
const HAIKU = "openrouter/anthropic/claude-haiku-5.5";
const DEEPSEEK = "openrouter/deepseek/deepseek-v4.1-flash";

function record(overrides: Partial<RunRecord>): RunRecord {
    return {
        runId: "run",
        timestamp: "2026-01-01T00:00:00.000Z",
        project: "p1",
        mode: "with",
        model: HAIKU,
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

function cell(project: string, model: string, costWithout: number, costWith: number) {
    return [
        record({
            runId: `${project}-${model}-wo`,
            project,
            model,
            mode: "without",
            costUsd: costWithout,
            success: false,
        }),
        record({
            runId: `${project}-${model}-w`,
            project,
            model,
            mode: "with",
            costUsd: costWith,
            success: true,
        }),
    ];
}

const index = matchCells([
    ...cell("p1", NANO, 0.1, 0.05),
    ...cell("p2", NANO, 0.2, 0.15),
    ...cell("p1", HAIKU, 0.1, 0.05),
    ...cell("p2", HAIKU, 0.2, 0.15),
    ...cell("p1", DEEPSEEK, 0.1, 0.05),
    ...cell("p2", DEEPSEEK, 0.2, 0.15),
]);

describe("headlineCompletion", () => {
    test("lists every matched model smallest first", () => {
        const spec = headlineCompletion(index);
        expect(spec.panels[0]?.categories.map((category) => category.label)).toEqual([
            "gpt-5-nano",
            "claude-haiku-5.5",
            "deepseek-v4.1-flash",
        ]);
    });

    test("has a with/without series and a matched-cell subtitle", () => {
        const spec = headlineCompletion(index);
        expect(spec.series.map((series) => series.name)).toEqual(["without", "with"]);
        expect(spec.subtitle).toContain("matched cells");
        const values = spec.panels[0]?.categories[0]?.values ?? [];
        expect(values).toHaveLength(2);
        expect(values[1]?.value).toBe(100);
    });
});

describe("headlineCostTime", () => {
    test("covers only flash-class models", () => {
        const spec = headlineCostTime(index);
        expect(spec.categories.map((category) => category.label)).toEqual([
            "claude-haiku-5.5",
            "deepseek-v4.1-flash",
        ]);
        expect(spec.metrics).toEqual(["cost / run", "wall time"]);
    });

    test("reports the paired median and a whisker across cells", () => {
        const spec = headlineCostTime(index);
        const bars = spec.categories[0]?.bars ?? [];
        // p1 −50%, p2 −25% → median −37.5% with a −50%…−25% whisker.
        expect(bars[0]?.value).toBeCloseTo(-37.5, 10);
        expect(bars[0]?.min).toBeCloseTo(-50, 10);
        expect(bars[0]?.max).toBeCloseTo(-25, 10);
        expect(bars[0]?.label).toBe("−38%");
    });
});
