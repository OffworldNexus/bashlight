import { describe, expect, test } from "bun:test";

import { rewrite, rewritten, uvProject, venvProject } from "./fixtures.ts";

describe("uv project", () => {
    const AT = { cwd: "/w", files: uvProject("/w") };

    test("wraps python through uv run", () => {
        expect(rewritten("python a.py", AT)).toBe("uv run python a.py");
    });

    test("rewrites pip install to uv add", () => {
        expect(rewritten("pip install x", AT)).toBe("uv add x");
    });
});

describe("venv project", () => {
    const AT = { cwd: "/w", files: venvProject("/w") };

    test("wraps python through the venv interpreter", () => {
        expect(rewritten("python a.py", AT)).toBe(".venv/bin/python a.py");
    });
});

describe("no project", () => {
    const AT = { cwd: "/plain", files: {} };

    test("routes python through uv run", () => {
        expect(rewritten("python3 script.py", AT)).toBe("uv run script.py");
    });

    test("blocks pip install", () => {
        const outcome = rewrite("pip install requests", AT);
        expect(outcome.kind).toBe("blocked");
        if (outcome.kind === "blocked") {
            expect(outcome.message).toContain("uv");
            expect(outcome.ruleIds).toContain("bare-python");
        }
    });

    test("keeps -c command strings", () => {
        expect(rewritten("python -c 'print(1)'", AT)).toBe(
            "uv run python -c 'print(1)'",
        );
    });
});
