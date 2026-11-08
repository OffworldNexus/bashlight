import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { WatchCommand } from "../../src/cli/commands/watch.ts";
import { NodeCliFiles } from "../../src/cli/files.ts";
import type { CommandIo } from "../../src/cli/io.ts";
import { auditLine, outputOf, ScriptedScheduler, tempDir, testIo } from "./fakes.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
    for (const cleanup of cleanups.splice(0)) {
        cleanup();
    }
});

function newLog(): { readonly dir: string; readonly log: string } {
    const { path, cleanup } = tempDir();
    cleanups.push(cleanup);
    return { dir: path, log: join(path, "audit.jsonl") };
}

function watchIo(_log: string, ticks: readonly (() => void)[]): CommandIo {
    const controller = new AbortController();
    return testIo({
        files: new NodeCliFiles(),
        signal: controller.signal,
        scheduler: new ScriptedScheduler(ticks, () => controller.abort()),
    });
}

describe("watch", () => {
    test("prints the tail, hiding unchanged entries by default", async () => {
        const { log } = newLog();
        writeFileSync(
            log,
            auditLine({ original: "pip install a" }) +
                auditLine({ outcome: "unchanged", original: "ls -la" }) +
                auditLine({
                    outcome: "blocked",
                    original: "pip install evil",
                    message: "not allowed",
                }) +
                auditLine({ original: "pip install b" }),
        );
        const io = watchIo(log, []);
        const code = await new WatchCommand().run(["--log", log], io);
        const text = outputOf(io).text();
        expect(code).toBe(0);
        expect(text).toContain("- pip install a");
        expect(text).toContain("+ poetry add requests");
        expect(text).toContain("blocked: not allowed");
        expect(text).toContain("- pip install b");
        expect(text).not.toContain("ls -la");
    });

    test("hides unchanged entries unless --all", async () => {
        const { log } = newLog();
        writeFileSync(log, auditLine({ outcome: "unchanged", original: "ls -la" }));
        const io = watchIo(log, []);
        await new WatchCommand().run(["--log", log], io);
        expect(outputOf(io).text()).toBe("");
    });

    test("shows unchanged entries with --all", async () => {
        const { log } = newLog();
        writeFileSync(log, auditLine({ outcome: "unchanged", original: "ls -la" }));
        const io = watchIo(log, []);
        await new WatchCommand().run(["--log", log, "--all"], io);
        expect(outputOf(io).text()).toContain("ls -la");
    });

    test("follows entries appended after the tail", async () => {
        const { log } = newLog();
        writeFileSync(log, auditLine({ original: "pip install first" }));
        const io = watchIo(log, [
            () => appendFileSync(log, auditLine({ original: "pip install second" })),
        ]);
        await new WatchCommand().run(["--log", log], io);
        const text = outputOf(io).text();
        expect(text).toContain("pip install first");
        expect(text).toContain("pip install second");
        const scheduler = io.scheduler as ScriptedScheduler;
        expect(scheduler.slept[0]).toBe(300);
    });

    test("waits for a log that does not exist yet, then follows it", async () => {
        const { log } = newLog();
        const io = watchIo(log, [
            () => {},
            () => writeFileSync(log, auditLine({ original: "pip install late" })),
        ]);
        await new WatchCommand().run(["--log", log], io);
        const text = outputOf(io).text();
        expect(text).toContain(`waiting for ${log} …`);
        expect(text).toContain("pip install late");
    });

    test("re-reads a truncated or rotated log", async () => {
        const { log } = newLog();
        writeFileSync(log, auditLine({ original: "pip install old" }));
        const io = watchIo(log, [
            () => writeFileSync(log, auditLine({ original: "pip install rotated" })),
        ]);
        await new WatchCommand().run(["--log", log], io);
        const text = outputOf(io).text();
        expect(text).toContain("was truncated or rotated");
        expect(text).toContain("pip install rotated");
    });

    test("filters the tail by --since", async () => {
        const { log } = newLog();
        writeFileSync(
            log,
            auditLine({
                time: "2020-01-01T00:00:00.000Z",
                original: "pip install ancient",
            }) +
                auditLine({
                    time: "2026-11-08T11:00:00.000Z",
                    original: "pip install new",
                }),
        );
        const io = watchIo(log, []);
        await new WatchCommand().run(["--log", log, "--since", "1d"], io);
        const text = outputOf(io).text();
        expect(text).toContain("pip install new");
        expect(text).not.toContain("pip install ancient");
    });

    test("rejects a bad --since with a usage error", async () => {
        const { log } = newLog();
        const io = watchIo(log, []);
        const code = await new WatchCommand().run(
            ["--log", log, "--since", "soon"],
            io,
        );
        expect(code).toBe(2);
        expect(outputOf(io).text()).toContain("invalid --since");
    });
});
