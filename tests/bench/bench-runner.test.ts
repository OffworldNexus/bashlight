import { describe, expect, test } from "bun:test";

import { buildMatrix, envRecord, slug } from "../../bench/lib/bench-runner.ts";

describe("buildMatrix", () => {
    test("repeats as the innermost loop and keeps a stable order", () => {
        const cells = buildMatrix({
            models: ["m1", "m2"],
            modes: ["with", "without"],
            projects: ["p1"],
            repeat: 2,
            dryRun: false,
            maxCostUsd: 0,
            timeoutMs: 1000,
            jobs: 3,
        });
        expect(
            cells.map((cell) => `${cell.mode}/${cell.model}#${cell.iteration}`),
        ).toEqual([
            "with/m1#1",
            "with/m1#2",
            "with/m2#1",
            "with/m2#2",
            "without/m1#1",
            "without/m1#2",
            "without/m2#1",
            "without/m2#2",
        ]);
    });
});

describe("slug", () => {
    test("makes a model id safe for a directory name", () => {
        expect(slug("openrouter/deepseek/deepseek-v4.1-flash")).toBe(
            "openrouter-deepseek-deepseek-v4.1-flash",
        );
    });
});

describe("envRecord", () => {
    test("drops undefined entries", () => {
        expect(envRecord({ A: "1", B: undefined })).toEqual({ A: "1" });
    });
});
