import { describe, expect, test } from "bun:test";

import { parseRunArgs } from "../../bench/lib/args.ts";

const defaults = {
    models: ["openrouter/deepseek/deepseek-v4.1-flash"],
    projects: ["poetry-shop", "uv-report"],
};

describe("parseRunArgs", () => {
    test("defaults to both modes and one repeat", () => {
        const parsed = parseRunArgs([], defaults);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) {
            return;
        }
        expect(parsed.options.modes).toEqual(["with", "without"]);
        expect(parsed.options.repeat).toBe(1);
        expect(parsed.options.maxCostUsd).toBe(Number.POSITIVE_INFINITY);
    });

    test("accepts comma-separated values and inline assignments", () => {
        const parsed = parseRunArgs(
            [
                "--models=a,b",
                "--modes",
                "with",
                "--projects",
                "poetry-shop",
                "--repeat=3",
            ],
            defaults,
        );
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) {
            return;
        }
        expect(parsed.options.models).toEqual(["a", "b"]);
        expect(parsed.options.modes).toEqual(["with"]);
        expect(parsed.options.projects).toEqual(["poetry-shop"]);
        expect(parsed.options.repeat).toBe(3);
    });

    test("rejects an unknown mode", () => {
        const parsed = parseRunArgs(["--modes", "sometimes"], defaults);
        expect(parsed.ok).toBe(false);
    });

    test("rejects a non-positive repeat", () => {
        const parsed = parseRunArgs(["--repeat", "0"], defaults);
        expect(parsed.ok).toBe(false);
    });

    test("converts the timeout to milliseconds", () => {
        const parsed = parseRunArgs(["--timeout", "30"], defaults);
        expect(parsed.ok).toBe(true);
        if (parsed.ok) {
            expect(parsed.options.timeoutMs).toBe(30_000);
        }
    });

    test("treats --dry-run as a boolean that consumes nothing", () => {
        const parsed = parseRunArgs(["--dry-run", "--repeat", "2"], defaults);
        expect(parsed.ok).toBe(true);
        if (parsed.ok) {
            expect(parsed.options.dryRun).toBe(true);
            expect(parsed.options.repeat).toBe(2);
        }
    });
});
