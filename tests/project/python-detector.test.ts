import { describe, expect, test } from "bun:test";

import {
    detectPython,
    HATCH_PYPROJECT,
    PDM_LOCK,
    PDM_PYPROJECT,
    PEP621_PYPROJECT,
    PIPFILE,
    POETRY_LOCK,
    POETRY_PYPROJECT,
    UV_LOCK,
    UV_PYPROJECT,
} from "./fixtures.ts";

describe("PythonToolchainDetector: managers", () => {
    test("poetry from a lockfile", () => {
        const tc = detectPython(
            {
                "/w/api/pyproject.toml": POETRY_PYPROJECT,
                "/w/api/poetry.lock": POETRY_LOCK,
            },
            "/w/api",
        );
        expect(tc?.manager).toBe("poetry");
        expect(tc?.root).toBe("/w/api");
        expect(tc?.venv).toBeUndefined();
    });

    test("uv from a lockfile", () => {
        const tc = detectPython(
            { "/w/api/pyproject.toml": UV_PYPROJECT, "/w/api/uv.lock": UV_LOCK },
            "/w/api",
        );
        expect(tc?.manager).toBe("uv");
        expect(tc?.root).toBe("/w/api");
    });

    test("pipenv from a Pipfile", () => {
        const tc = detectPython({ "/w/api/Pipfile": PIPFILE }, "/w/api");
        expect(tc?.manager).toBe("pipenv");
    });

    test("pdm from a lockfile", () => {
        const tc = detectPython(
            { "/w/api/pyproject.toml": PDM_PYPROJECT, "/w/api/pdm.lock": PDM_LOCK },
            "/w/api",
        );
        expect(tc?.manager).toBe("pdm");
    });

    test("hatch from the pyproject section", () => {
        const tc = detectPython({ "/w/api/pyproject.toml": HATCH_PYPROJECT }, "/w/api");
        expect(tc?.manager).toBe("hatch");
    });

    test("poetry from the pyproject section", () => {
        const tc = detectPython(
            { "/w/api/pyproject.toml": POETRY_PYPROJECT },
            "/w/api",
        );
        expect(tc?.manager).toBe("poetry");
    });

    test("PEP 621 project defaults to uv when there is no venv", () => {
        const tc = detectPython(
            { "/w/api/pyproject.toml": PEP621_PYPROJECT },
            "/w/api",
        );
        expect(tc?.manager).toBe("uv");
    });

    test("PEP 621 project with a venv becomes venv", () => {
        const tc = detectPython(
            {
                "/w/api/pyproject.toml": PEP621_PYPROJECT,
                "/w/api/.venv/bin/python": "",
            },
            "/w/api",
        );
        expect(tc?.manager).toBe("venv");
        expect(tc?.venv).toBe("/w/api/.venv");
    });

    test("venv-only directory", () => {
        const tc = detectPython({ "/w/api/venv/bin/python": "" }, "/w/api");
        expect(tc?.manager).toBe("venv");
        expect(tc?.venv).toBe("/w/api/venv");
    });
});

describe("PythonToolchainDetector: precedence and edge cases", () => {
    test("both lockfiles prefer the pyproject section, else poetry", () => {
        const both = { "/w/api/poetry.lock": POETRY_LOCK, "/w/api/uv.lock": UV_LOCK };
        const poetry = detectPython(
            { ...both, "/w/api/pyproject.toml": POETRY_PYPROJECT },
            "/w/api",
        );
        expect(poetry?.manager).toBe("poetry");

        const uv = detectPython(
            { ...both, "/w/api/pyproject.toml": UV_PYPROJECT },
            "/w/api",
        );
        expect(uv?.manager).toBe("uv");

        const unknown = detectPython(
            { ...both, "/w/api/pyproject.toml": PEP621_PYPROJECT },
            "/w/api",
        );
        expect(unknown?.manager).toBe("poetry");
    });

    test("requirements-only project has no toolchain", () => {
        const tc = detectPython({ "/w/api/requirements.txt": "flask\n" }, "/w/api");
        expect(tc).toBeUndefined();
    });

    test("setup.py-only project has no toolchain", () => {
        const tc = detectPython(
            { "/w/api/setup.py": "from setuptools import setup\n" },
            "/w/api",
        );
        expect(tc).toBeUndefined();
    });

    test("no project at all", () => {
        expect(detectPython({ "/etc/hosts": "" }, "/etc")).toBeUndefined();
    });

    test("finds the project from a deep cwd", () => {
        const tc = detectPython(
            {
                "/w/api/pyproject.toml": POETRY_PYPROJECT,
                "/w/api/poetry.lock": POETRY_LOCK,
                "/w/api/src/app/main.py": "",
            },
            "/w/api/src/app",
        );
        expect(tc?.manager).toBe("poetry");
        expect(tc?.root).toBe("/w/api");
    });

    test("innermost project wins", () => {
        const tc = detectPython(
            {
                "/w/pyproject.toml": POETRY_PYPROJECT,
                "/w/poetry.lock": POETRY_LOCK,
                "/w/packages/a/pyproject.toml": PEP621_PYPROJECT,
            },
            "/w/packages/a",
        );
        expect(tc?.manager).toBe("uv");
        expect(tc?.root).toBe("/w/packages/a");
    });

    test("uv monorepo resolves to the workspace root", () => {
        const tc = detectPython(
            {
                "/w/pyproject.toml": `[project]
name = "root"

[tool.uv.workspace]
members = ["packages/a"]
`,
                "/w/uv.lock": UV_LOCK,
                "/w/packages/a/pyproject.toml": PEP621_PYPROJECT,
            },
            "/w/packages/a",
        );
        expect(tc?.manager).toBe("uv");
        expect(tc?.root).toBe("/w");
    });

    test("poetry lock at a parent workspace root is used", () => {
        const tc = detectPython(
            {
                "/w/pyproject.toml": POETRY_PYPROJECT,
                "/w/poetry.lock": POETRY_LOCK,
                "/w/packages/a/pyproject.toml": `[tool.poetry]
name = "a"
`,
            },
            "/w/packages/a",
        );
        expect(tc?.manager).toBe("poetry");
        expect(tc?.root).toBe("/w");
    });

    test("a local poetry lock keeps the project root local", () => {
        const tc = detectPython(
            {
                "/w/poetry.lock": POETRY_LOCK,
                "/w/packages/a/pyproject.toml": `[tool.poetry]
name = "a"
`,
                "/w/packages/a/poetry.lock": POETRY_LOCK,
            },
            "/w/packages/a",
        );
        expect(tc?.root).toBe("/w/packages/a");
    });

    test("uv workspace root exposes its venv", () => {
        const tc = detectPython(
            {
                "/w/pyproject.toml": `[project]
name = "root"

[tool.uv.workspace]
members = ["packages/a"]
`,
                "/w/uv.lock": UV_LOCK,
                "/w/.venv/bin/python": "",
                "/w/packages/a/pyproject.toml": PEP621_PYPROJECT,
            },
            "/w/packages/a",
        );
        expect(tc?.root).toBe("/w");
        expect(tc?.venv).toBe("/w/.venv");
    });

    test("uv workspace root falls back to a member package venv", () => {
        const tc = detectPython(
            {
                "/w/pyproject.toml": `[project]
name = "root"

[tool.uv.workspace]
members = ["packages/a"]
`,
                "/w/uv.lock": UV_LOCK,
                "/w/packages/a/pyproject.toml": UV_PYPROJECT,
                "/w/packages/a/.venv/bin/python": "",
            },
            "/w/packages/a",
        );
        expect(tc?.manager).toBe("uv");
        expect(tc?.root).toBe("/w");
        expect(tc?.venv).toBe("/w/packages/a/.venv");
    });
});
