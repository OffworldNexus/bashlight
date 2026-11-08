import { describe, expect, test } from "bun:test";

import {
    buildHeadlines,
    headlinesDocument,
    modelHeadline,
} from "../../bench/lib/headlines.ts";
import {
    displayName,
    modelConfig,
    modelsInTier,
    orderBySize,
    tierOf,
} from "../../bench/lib/models.ts";
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

/** A matched cell: one without run and one with run, with chosen costs. */
function cell(
    project: string,
    model: string,
    costWithout: number,
    costWith: number,
    wallWithout = 10,
    wallWith = 8,
): RunRecord[] {
    return [
        record({
            runId: `${project}-${model}-wo`,
            project,
            model,
            mode: "without",
            costUsd: costWithout,
            wallMs: wallWithout * 1000,
            success: false,
        }),
        record({
            runId: `${project}-${model}-w`,
            project,
            model,
            mode: "with",
            costUsd: costWith,
            wallMs: wallWith * 1000,
            success: true,
        }),
    ];
}

// p1 is −50% cost / −25% time; p2 is −25% cost / −50% time, for every model.
function boundaries() {
    return [
        ...cell("p1", NANO, 0.1, 0.05, 10, 7.5),
        ...cell("p2", NANO, 0.2, 0.15, 10, 5),
        ...cell("p1", HAIKU, 0.1, 0.05, 10, 7.5),
        ...cell("p2", HAIKU, 0.2, 0.15, 10, 5),
        ...cell("p1", DEEPSEEK, 0.1, 0.05, 10, 7.5),
        ...cell("p2", DEEPSEEK, 0.2, 0.15, 10, 5),
    ];
}

describe("model tiers", () => {
    test("orders models small → large by output price", () => {
        expect(orderBySize([DEEPSEEK, NANO, HAIKU])).toEqual([NANO, HAIKU, DEEPSEEK]);
    });

    test("classifies the default set", () => {
        expect(tierOf(NANO)).toBe("small");
        expect(tierOf(HAIKU)).toBe("flash");
        expect(tierOf(DEEPSEEK)).toBe("flash");
        expect(displayName(NANO)).toBe("gpt-5-nano");
    });

    test("filters and orders models within a tier", () => {
        expect(modelsInTier([DEEPSEEK, NANO, HAIKU], "flash")).toEqual([
            HAIKU,
            DEEPSEEK,
        ]);
    });

    test("treats an unknown model as flash and orders it last", () => {
        const unknown = "openrouter/acme/mystery-1";
        expect(modelConfig(unknown).tier).toBe("flash");
        expect(orderBySize([DEEPSEEK, unknown])).toEqual([DEEPSEEK, unknown]);
    });
});

describe("buildHeadlines", () => {
    const index = matchCells(boundaries());
    const headlines = buildHeadlines(index);

    test("counts the matched cells and runs", () => {
        expect(headlines.matchedCells).toBe(6);
        expect(headlines.runs).toBe(12);
    });

    test("completion lists every model smallest first", () => {
        expect(headlines.completion.map((entry) => entry.model)).toEqual([
            NANO,
            HAIKU,
            DEEPSEEK,
        ]);
    });

    test("cost/time covers only flash-class models, smallest first", () => {
        expect(headlines.costTime.map((entry) => entry.model)).toEqual([
            HAIKU,
            DEEPSEEK,
        ]);
    });

    test("reports the paired median change and its spread", () => {
        const haiku = headlines.completion.find((entry) => entry.model === HAIKU);
        // p1 cost −50%, p2 cost −25% → median −37.5%, min −50%, max −25%.
        expect(haiku?.cost.samples).toBe(2);
        expect(haiku?.cost.median).toBeCloseTo(-37.5, 10);
        expect(haiku?.cost.min).toBeCloseTo(-50, 10);
        expect(haiku?.cost.max).toBeCloseTo(-25, 10);
        expect(haiku?.cells).toBe(2);
        expect(haiku?.runsWithout).toBe(2);
        expect(haiku?.runsWith).toBe(2);
    });

    test("reports completion with vs without", () => {
        const deepseek = modelHeadline(index, DEEPSEEK);
        expect(deepseek.successWithout).toBe(0);
        expect(deepseek.successWith).toBe(1);
    });

    test("reports per-task completion for the small tier", () => {
        expect(headlines.smallTier?.model).toBe(NANO);
        expect(headlines.smallTier?.tasks.map((task) => task.project)).toEqual([
            "p1",
            "p2",
        ]);
        expect(headlines.smallTier?.tasks[0]?.deltaPoints).toBeCloseTo(100, 10);
        expect(headlines.smallTier?.overall.runsWithout).toBe(2);
        expect(headlines.smallTier?.overall.runsWith).toBe(2);
        expect(headlines.smallTier?.overall.successWithout).toBe(0);
        expect(headlines.smallTier?.overall.successWith).toBe(1);
    });
});

describe("headlinesDocument", () => {
    test("serialises the two messages", () => {
        const document = headlinesDocument(buildHeadlines(matchCells(boundaries())));
        expect(document.matchedCells).toBe(6);
        expect(document.runs).toBe(12);
        expect((document.costTime as { tier: string }).tier).toBe("flash");
        const completion = document.completion as {
            models: { model: string; successWith: number; successWithout: number }[];
        };
        expect(completion.models.map((entry) => entry.model)).toEqual([
            NANO,
            HAIKU,
            DEEPSEEK,
        ]);
        expect(completion.models[0]?.successWith).toBe(1);
        expect(completion.models[0]?.successWithout).toBe(0);
    });

    test("includes the small tier's per-task completion", () => {
        const document = headlinesDocument(buildHeadlines(matchCells(boundaries())));
        const small = document.smallTierCompletion as {
            model: string;
            tasks: { project: string }[];
            overall: { runsWith: number };
        };
        expect(small.model).toBe(NANO);
        expect(small.tasks.map((task) => task.project)).toEqual(["p1", "p2"]);
        expect(small.overall.runsWith).toBe(2);
    });
});
