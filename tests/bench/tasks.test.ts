import { describe, expect, test } from "bun:test";

import { parseCsv, taskFor, TASKS } from "../../bench/tasks.ts";

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
});
