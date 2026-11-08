import { describe, expect, test } from "bun:test";

import type { BenchFileSystem } from "../../bench/lib/fs.ts";
import { projectDiff, RunPruner, transcriptFromEvents } from "../../bench/lib/prune.ts";

/** An in-memory filesystem with directory inference from file paths. */
class MemFS implements BenchFileSystem {
    private readonly files = new Map<string, string>();

    constructor(initial: Record<string, string> = {}) {
        for (const [path, content] of Object.entries(initial)) {
            this.files.set(path, content);
        }
    }

    private under(path: string): readonly string[] {
        const prefix = path.endsWith("/") ? path : `${path}/`;
        return [...this.files.keys()].filter((key) => key.startsWith(prefix));
    }

    mkdirp(): void {}

    writeFile(path: string, content: string): void {
        this.files.set(path, content);
    }

    readFile(path: string): string | undefined {
        return this.files.get(path);
    }

    exists(path: string): boolean {
        return this.files.has(path) || this.under(path).length > 0;
    }

    isDirectory(path: string): boolean {
        return !this.files.has(path) && this.under(path).length > 0;
    }

    readDirectory(path: string): readonly string[] {
        const prefix = path.endsWith("/") ? path : `${path}/`;
        const names = new Set<string>();
        for (const key of this.files.keys()) {
            if (!key.startsWith(prefix)) {
                continue;
            }
            const first = key.slice(prefix.length).split("/")[0];
            if (first !== undefined && first !== "") {
                names.add(first);
            }
        }
        return [...names];
    }

    copyTree(): void {}

    remove(path: string): void {
        this.files.delete(path);
        for (const key of this.under(path)) {
            this.files.delete(key);
        }
    }

    keys(): readonly string[] {
        return [...this.files.keys()].sort((left, right) => left.localeCompare(right));
    }
}

describe("transcriptFromEvents", () => {
    test("keeps text, tool calls and errors, drops the rest", () => {
        const events = [
            JSON.stringify({ type: "step_start", timestamp: 1 }),
            JSON.stringify({ type: "text", part: { text: "hello" } }),
            JSON.stringify({
                type: "tool_use",
                part: {
                    tool: "shell",
                    state: { status: "completed", input: { command: "ls" } },
                },
            }),
            JSON.stringify({
                type: "tool_use",
                part: { tool: "read", state: { status: "error", error: "boom" } },
            }),
            JSON.stringify({ type: "error", error: { message: "bad" } }),
        ].join("\n");
        const transcript = transcriptFromEvents(events);
        const lines = transcript.trim().split("\n");
        expect(lines).toHaveLength(4);
        expect(transcript).toContain('"text":"hello"');
        expect(transcript).toContain('"tool":"shell"');
        expect(transcript).toContain('"command":"ls"');
        expect(transcript).toContain('"error":"boom"');
        expect(transcript).toContain('"message":"bad"');
        expect(transcript).not.toContain("step_start");
    });

    test("returns an empty string for malformed input", () => {
        expect(transcriptFromEvents("not json\n\n")).toBe("");
    });
});

describe("projectDiff", () => {
    const template = {
        "/t/README.md": "v1",
        "/t/pyproject.toml": "same",
        "/t/old.py": "old",
    };
    const project = {
        "/p/README.md": "v2",
        "/p/pyproject.toml": "same",
        "/p/data.csv": "new",
        "/p/app/cli.py": "print(1)",
        "/p/.venv/lib/python/site.py": "ignored",
        "/p/node_modules/pkg/index.js": "ignored",
    };

    test("lists added, changed and removed files, skipping build dirs", () => {
        const diff = projectDiff(new MemFS({ ...template, ...project }), "/t", "/p");
        expect(diff.map((entry) => `${entry.status} ${entry.path}`)).toEqual([
            "added app/cli.py",
            "added data.csv",
            "removed old.py",
            "changed README.md",
        ]);
        expect(diff.find((entry) => entry.path === "README.md")?.content).toBe("v2");
        expect(diff.find((entry) => entry.path === "old.py")?.content).toBeUndefined();
    });

    test("omits contents beyond the byte budget but keeps the paths", () => {
        const diff = projectDiff(new MemFS({ ...template, ...project }), "/t", "/p", 4);
        expect(diff.map((entry) => entry.path)).toContain("data.csv");
        const capped = diff.filter((entry) => entry.contentOmitted === true);
        expect(capped.length).toBeGreaterThan(0);
    });
});

describe("RunPruner", () => {
    const events = [
        JSON.stringify({ type: "text", part: { text: "done" } }),
        JSON.stringify({
            type: "tool_use",
            part: {
                tool: "shell",
                state: { status: "completed", input: { command: "ls" } },
            },
        }),
    ].join("\n");

    function tree(extra: Record<string, string> = {}): MemFS {
        return new MemFS({
            "/art/events.jsonl": events,
            "/art/check.txt": "ok\n",
            "/run/data/opencode/log/server.log": "log line\n",
            "/run/data/opencode/opencode.db": "BIG DATABASE",
            "/run/project/.venv/lib/x.py": "venv",
            "/run/project/node_modules/pkg/index.js": "modules",
            "/run/project/app/cli.py": "print(1)",
            "/run/cache/opencode/blob": "cache",
            ...extra,
        });
    }

    test("keeps the small artefacts and deletes the working directory", () => {
        const fs = tree();
        new RunPruner(fs).prune({
            runDirectory: "/run",
            projectDirectory: "/run/project",
            templateDirectory: "/t",
            artifactsDirectory: "/art",
        });
        expect(fs.keys()).toEqual([
            "/art/check.txt",
            "/art/diff.json",
            "/art/events.jsonl",
            "/art/opencode.log",
            "/art/transcript.jsonl",
        ]);
        expect(fs.readFile("/art/opencode.log")).toBe("log line\n");
        expect(fs.readFile("/art/transcript.jsonl")).toContain('"text":"done"');
        expect(fs.readFile("/art/diff.json")).toContain("app/cli.py");
    });

    test("keeps the working directory when asked", () => {
        const fs = tree();
        new RunPruner(fs).prune({
            runDirectory: "/run",
            projectDirectory: "/run/project",
            templateDirectory: "/t",
            artifactsDirectory: "/art",
            keepWorkingDirectory: true,
        });
        expect(fs.exists("/run/project/app/cli.py")).toBe(true);
    });
});
