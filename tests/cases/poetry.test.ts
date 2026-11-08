import { describe, expect, test } from "bun:test";

import { poetryProject, rewrite, rewritten } from "./fixtures.ts";

const FILES = poetryProject("/w");
const AT = { cwd: "/w", files: FILES };

describe("poetry project", () => {
    test("wraps a bare python invocation", () => {
        expect(rewritten("python a.py", AT)).toBe("poetry run python a.py");
    });

    test("wraps after a cd", () => {
        expect(rewritten("cd /w && python a.py", AT)).toBe(
            "cd /w && poetry run python a.py",
        );
    });

    test("folds a repeated prefix into the assignment", () => {
        expect(rewritten('P="python"; $P a.py; $P b.py', AT)).toBe(
            'P="poetry run python"; $P a.py; $P b.py',
        );
    });

    test("does not fold when another use would change", () => {
        expect(rewritten('P="python"; $P a.py; echo $P', AT)).toBe(
            'P="python"; poetry run $P a.py; echo $P',
        );
    });

    test("rewrites pip install to poetry add", () => {
        expect(rewritten("pip install requests", AT)).toBe("poetry add requests");
    });

    test("rewrites python -m pip install -U to poetry add @latest", () => {
        expect(rewritten("python -m pip install -U requests", AT)).toBe(
            "poetry add requests@latest",
        );
    });

    test("wraps a declared tool", () => {
        expect(rewritten("pytest -x", AT)).toBe("poetry run pytest -x");
    });

    test("keeps wrapper words and inserts after them", () => {
        expect(rewritten("sudo -E timeout 60 python a.py", AT)).toBe(
            "sudo -E timeout 60 poetry run python a.py",
        );
    });

    test("rewrites inside bash -c", () => {
        expect(rewritten("bash -c 'cd /w && python a.py'", AT)).toBe(
            "bash -c 'cd /w && poetry run python a.py'",
        );
    });

    test("leaves remote commands alone", () => {
        expect(rewrite("ssh host 'python a.py'", AT).kind).toBe("unchanged");
    });

    test("leaves a command that activates a venv alone", () => {
        expect(rewrite("source .venv/bin/activate && python a.py", AT).kind).toBe(
            "unchanged",
        );
    });

    test("keeps redirections after the command", () => {
        expect(rewritten("python a.py > out.txt 2>&1", AT)).toBe(
            "poetry run python a.py > out.txt 2>&1",
        );
    });

    test("rewrites inside a for loop", () => {
        expect(rewritten('for f in a.py b.py; do python "$f"; done', AT)).toBe(
            'for f in a.py b.py; do poetry run python "$f"; done',
        );
    });

    test("rewrites before a quoted heredoc", () => {
        expect(rewritten("python - <<'EOF'\nprint(1)\nEOF", AT)).toBe(
            "poetry run python - <<'EOF'\nprint(1)\nEOF",
        );
    });

    test("swaps a foreign runner for the project runner", () => {
        expect(rewritten("uv run pytest", AT)).toBe("poetry run pytest");
    });

    test("resolves a script shebang against the project runner", () => {
        expect(rewritten("./manage.py migrate", AT)).toBe(
            "poetry run ./manage.py migrate",
        );
    });

    test("rewrites inside a subshell pipeline", () => {
        expect(rewritten("(cd /w && python a.py) | tee log", AT)).toBe(
            "(cd /w && poetry run python a.py) | tee log",
        );
    });
});
