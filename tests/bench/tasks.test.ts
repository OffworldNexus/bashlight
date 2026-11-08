import { describe, expect, test } from "bun:test";

import type { CommandResult } from "../../bench/lib/command.ts";
import type { BenchFileSystem } from "../../bench/lib/fs.ts";
import { parseCsv, taskFor, TASKS } from "../../bench/tasks.ts";

class MemoryFileSystem implements BenchFileSystem {
    constructor(private readonly files: Record<string, string> = {}) {}

    mkdirp(): void {}

    writeFile(): void {}

    readFile(path: string): string | undefined {
        return this.files[path];
    }

    exists(path: string): boolean {
        return path in this.files;
    }

    isDirectory(): boolean {
        return false;
    }

    readDirectory(): readonly string[] {
        return [];
    }

    copyTree(): void {}

    remove(): void {}
}

function failingRun(): Promise<CommandResult> {
    return Promise.resolve({
        code: 1,
        signal: null,
        stdout: "",
        stderr: "boom",
        timedOut: false,
        durationMs: 1,
    });
}

describe("parseCsv", () => {
    test("maps rows onto the header names", () => {
        const rows = parseCsv("name,role\nAda,admin\nGrace,editor\n");
        expect(rows).toEqual([
            { name: "Ada", role: "admin" },
            { name: "Grace", role: "editor" },
        ]);
    });

    test("honours double-quoted fields", () => {
        expect(parseCsv('a,b\n"x,y",z\n')).toEqual([{ a: "x,y", b: "z" }]);
    });

    test("returns an empty list for a header-only document", () => {
        expect(parseCsv("a,b\n")).toEqual([]);
    });
});

describe("TASKS", () => {
    test("exposes the five benchmark projects in order", () => {
        expect(TASKS.map((task) => task.project)).toEqual([
            "monorepo",
            "uv-cli",
            "poetry-django-lite",
            "scripts",
            "pnpm-web",
        ]);
    });

    test("every task has a prompt and at least one install step except scripts", () => {
        for (const task of TASKS) {
            expect(task.prompt.length).toBeGreaterThan(20);
            if (task.project === "scripts") {
                expect(task.install).toHaveLength(0);
            } else {
                expect(task.install.length).toBeGreaterThan(0);
            }
        }
        expect(taskFor("nope")).toBeUndefined();
    });

    test("each prompt names the libraries and symbols its checker requires", () => {
        const required: Record<string, readonly string[]> = {
            monorepo: ["python-slugify", "zod", "endpoint_path", "parseEndpoint"],
            "uv-cli": ["tabulate", "PyYAML", "table", "config"],
            "poetry-django-lite": ["PyYAML", "report", "out/inventory.csv", "sku"],
            scripts: ["PyYAML", "name", "role"],
            "pnpm-web": ["dayjs", "zod", "formatRelative", "parseItem"],
        };
        for (const task of TASKS) {
            for (const needle of required[task.project] ?? []) {
                expect(task.prompt).toContain(needle);
            }
        }
    });
});

describe("checker failure detail", () => {
    test("lists every failing condition, not just the first", async () => {
        const task = taskFor("uv-cli");
        const result = await task?.check({
            projectDirectory: "/work",
            fs: new MemoryFileSystem({
                "/work/pyproject.toml": '[project]\nname = "x"\n',
            }),
            run: failingRun,
        });
        expect(result?.success).toBe(false);
        for (const needle of [
            "pytest did not pass",
            "ruff check did not pass",
            "mypy did not pass",
            "`table` did not print",
            "`config` did not print",
            "tabulate is not declared",
            "pyyaml is not declared",
        ]) {
            expect(result?.detail).toContain(needle);
        }
    });

    test("reports both missing-output conditions for scripts", async () => {
        const task = taskFor("scripts");
        const result = await task?.check({
            projectDirectory: "/work",
            fs: new MemoryFileSystem(),
            run: failingRun,
        });
        expect(result?.detail).toContain("data.csv was not produced");
        expect(result?.detail).toContain("no Python script using yaml was kept");
    });
});
