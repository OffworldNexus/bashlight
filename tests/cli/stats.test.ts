import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { StatsCommand } from "../../src/cli/commands/stats.ts";
import { NodeCliFiles } from "../../src/cli/files.ts";
import { auditLine, outputOf, tempDir, testIo } from "./fakes.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
    for (const cleanup of cleanups.splice(0)) {
        cleanup();
    }
});

const NOW = "2026-11-08T11:00:00.000Z";
const OLD = "2020-01-01T00:00:00.000Z";

function writeLog(): string {
    const { path, cleanup } = tempDir();
    cleanups.push(cleanup);
    const log = join(path, "audit.jsonl");
    writeFileSync(
        log,
        auditLine({
            time: NOW,
            original: "pip install requests",
            cwd: "/home/u/proj",
        }) +
            auditLine({
                time: NOW,
                original: "pip install numpy",
                cwd: "/home/u/proj",
            }) +
            auditLine({
                time: NOW,
                outcome: "unchanged",
                original: "ls -la",
                cwd: "/home/u/proj",
            }) +
            auditLine({
                time: NOW,
                outcome: "blocked",
                original: "pip install evil",
                message: "nope",
                cwd: "/home/u/other",
                ruleIds: ["bare-python"],
            }) +
            auditLine({
                time: NOW,
                original: "npm install",
                command: "pnpm add",
                cwd: "/home/u/other",
                ruleIds: ["node-manager"],
                reasons: ["use pnpm"],
            }) +
            auditLine({
                time: OLD,
                original: "pip install old",
                cwd: "/home/u/ancient",
            }) +
            "this is not json\n",
    );
    return log;
}

describe("stats", () => {
    test("renders totals, rules, rewrites and cwds", async () => {
        const log = writeLog();
        const io = testIo({ files: new NodeCliFiles() });
        const code = await new StatsCommand().run(["--log", log, "--since", "1d"], io);
        const text = outputOf(io).text();
        expect(code).toBe(0);
        expect(text).toContain("Entries:      5");
        expect(text).toContain("Rewritten:    3 (60%)");
        expect(text).toContain("Blocked:      1");
        expect(text).toContain("Unchanged:    1");
        expect(text).toContain("pip-to-manager");
        expect(text).toContain("pip install → poetry add");
        expect(text).toContain("~/proj");
        expect(text).not.toContain("ancient");
    });

    test("--json prints a machine-readable report", async () => {
        const log = writeLog();
        const io = testIo({ files: new NodeCliFiles() });
        await new StatsCommand().run(["--log", log, "--since", "1d", "--json"], io);
        const report = JSON.parse(outputOf(io).lines[0] ?? "{}") as {
            totals: Record<string, number>;
            rules: { key: string; count: number }[];
            rewrites: { from: string; to: string; count: number }[];
            cwds: { key: string; count: number }[];
            days: { date: string }[];
        };
        expect(report.totals).toEqual({
            entries: 5,
            rewritten: 3,
            blocked: 1,
            unchanged: 1,
            rewrittenPercent: 60,
        });
        expect(report.rules[0]).toEqual({ key: "pip-to-manager", count: 2 });
        expect(report.rewrites[0]).toEqual({
            from: "pip install",
            to: "poetry add",
            count: 2,
        });
        expect(report.cwds[0]).toEqual({ key: "/home/u/proj", count: 3 });
        expect(report.days[0]?.date).toBe("2026-11-08");
    });

    test("the --since window excludes older entries", async () => {
        const log = writeLog();
        const io = testIo({ files: new NodeCliFiles() });
        await new StatsCommand().run(["--log", log, "--json"], io);
        const report = JSON.parse(outputOf(io).lines[0] ?? "{}") as {
            totals: Record<string, number>;
        };
        // The default window is 7 days from the fixed clock (2026-11-08).
        expect(report.totals.entries).toBe(5);
    });

    test("a missing log reports an empty report", async () => {
        const { path, cleanup } = tempDir();
        cleanups.push(cleanup);
        const io = testIo({ files: new NodeCliFiles() });
        const code = await new StatsCommand().run(
            ["--log", join(path, "missing.jsonl"), "--json"],
            io,
        );
        const report = JSON.parse(outputOf(io).lines[0] ?? "{}") as {
            totals: Record<string, number>;
        };
        expect(code).toBe(0);
        expect(report.totals.entries).toBe(0);
    });

    test("rejects a bad --since", async () => {
        const log = writeLog();
        const io = testIo({ files: new NodeCliFiles() });
        const code = await new StatsCommand().run(["--log", log, "--since", "x"], io);
        expect(code).toBe(2);
    });
});
