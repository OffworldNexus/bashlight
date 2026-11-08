import { describe, expect, test } from "bun:test";

import type { BenchFileSystem } from "../../bench/lib/fs.ts";
import {
    isResultsFileName,
    parseResults,
    ResultsStore,
} from "../../bench/lib/results-store.ts";
import type { RunRecord } from "../../bench/lib/types.ts";

function record(runId: string): RunRecord {
    return {
        runId,
        timestamp: "2026-01-01T00:00:00.000Z",
        project: "poetry-shop",
        mode: "with",
        model: "m",
        success: true,
        detail: "",
        wallMs: 1,
        tokens: { input: 1, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
        costUsd: 0.001,
        toolCalls: 1,
        shellCalls: 1,
        failedShellCalls: 0,
        rewrites: 0,
        blocks: 0,
    };
}

class MemoryFileSystem implements BenchFileSystem {
    private readonly files = new Map<string, string>();

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

describe("parseResults", () => {
    test("keeps valid records and skips malformed lines", () => {
        const text = [
            JSON.stringify(record("a")),
            "not json",
            JSON.stringify({ runId: "b" }),
            JSON.stringify(record("c")),
        ].join("\n");
        expect(parseResults(text).map((item) => item.runId)).toEqual(["a", "c"]);
    });
});

describe("isResultsFileName", () => {
    test("accepts the runner's timestamped files and rejects archives", () => {
        expect(isResultsFileName("2026-11-08T18-33-21-067Z.jsonl")).toBe(true);
        expect(isResultsFileName("v1-2026-11-08.jsonl")).toBe(false);
        expect(isResultsFileName("results.jsonl")).toBe(false);
        expect(isResultsFileName("2026-11-08T18-33-21-067Z.txt")).toBe(false);
    });
});

describe("ResultsStore", () => {
    test("appends and reads back", () => {
        const store = new ResultsStore(new MemoryFileSystem(), "/results.jsonl");
        store.append(record("a"));
        store.append(record("b"));
        expect(store.records().map((item) => item.runId)).toEqual(["a", "b"]);
    });
});
