import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { ExplainCommand } from "../../src/cli/commands/explain.ts";
import { NodeCliFiles } from "../../src/cli/files.ts";
import type { Outcome } from "../../src/outcome.ts";
import { MemoryFileSystem } from "../../src/project/index.ts";
import { outputOf, tempDir, testIo } from "./fakes.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
    for (const cleanup of cleanups.splice(0)) {
        cleanup();
    }
});

const poetry = (): MemoryFileSystem =>
    new MemoryFileSystem({
        "/w/pyproject.toml": '[tool.poetry]\nname = "api"\nversion = "0.1.0"\n',
        "/w/poetry.lock": "",
    });

describe("explain", () => {
    test("shows a red/green diff and the changes for a rewrite", async () => {
        const io = testIo({ fileSystem: poetry(), cwd: "/w" });
        const code = await new ExplainCommand().run(["pip", "install", "requests"], io);
        const text = outputOf(io).text();
        expect(code).toBe(0);
        expect(text).toContain("rewritten:");
        expect(text).toContain("- pip install requests");
        expect(text).toContain("+ poetry add requests");
        expect(text).toContain("pip-to-manager");
        expect(text).toContain("install with the project manager");
    });

    test("accepts one quoted argument and a --cwd", async () => {
        const io = testIo({ fileSystem: poetry(), cwd: "/elsewhere" });
        await new ExplainCommand().run(["pip install requests", "--cwd", "/w"], io);
        expect(outputOf(io).text()).toContain("+ poetry add requests");
    });

    test("shows the block message for a blocked command", async () => {
        const io = testIo({ fileSystem: new MemoryFileSystem({}), cwd: "/w" });
        const code = await new ExplainCommand().run(["pip", "install", "requests"], io);
        const text = outputOf(io).text();
        expect(code).toBe(0);
        expect(text).toContain("blocked:");
        expect(text).toContain("PEP 723");
    });

    test("reports an unchanged command", async () => {
        const io = testIo({ fileSystem: poetry(), cwd: "/w" });
        await new ExplainCommand().run(["ls", "-la"], io);
        expect(outputOf(io).text()).toContain("unchanged");
    });

    test("reads the command from stdin with -", async () => {
        const io = testIo({
            fileSystem: poetry(),
            cwd: "/w",
            readStdin: () => Promise.resolve("pip install requests\n"),
        });
        await new ExplainCommand().run(["-"], io);
        expect(outputOf(io).text()).toContain("+ poetry add requests");
    });

    test("uses an injected processor factory", async () => {
        const outcome: Outcome = {
            kind: "blocked",
            message: "custom verdict",
            ruleIds: [],
        };
        const io = testIo({
            fileSystem: poetry(),
            processorFactory: () => ({ process: () => outcome }),
        });
        await new ExplainCommand().run(["anything"], io);
        expect(outputOf(io).text()).toContain("custom verdict");
    });

    test("exits 2 when no command is given", async () => {
        const io = testIo({ fileSystem: poetry() });
        const code = await new ExplainCommand().run([], io);
        expect(code).toBe(2);
        expect(outputOf(io).text()).toContain("no command given");
    });

    test("exits 2 when --env-file cannot be read", async () => {
        const io = testIo({ fileSystem: poetry(), cwd: "/w" });
        const code = await new ExplainCommand().run(
            ["ls", "--env-file", "/w/nope.env"],
            io,
        );
        expect(code).toBe(2);
        expect(outputOf(io).text()).toContain("cannot read --env-file");
    });

    test("applies an --env-file over the process environment", async () => {
        const { path, cleanup } = tempDir();
        cleanups.push(cleanup);
        const envFile = join(path, "vars.env");
        writeFileSync(envFile, "# a comment\nVIRTUAL_ENV=/w/.venv\n");
        const io = testIo({
            fileSystem: poetry(),
            files: new NodeCliFiles(),
            cwd: "/w",
        });
        const code = await new ExplainCommand().run(["ls", "--env-file", envFile], io);
        expect(code).toBe(0);
    });
});
