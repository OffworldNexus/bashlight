import { describe, expect, test } from "bun:test";

import { given, kept } from "./harness.ts";

/** A uv project whose virtualenv `bin` holds Python console scripts. */
const UV_VENV = {
    "/w/pyproject.toml": `[project]
name = "api"
version = "0.1.0"
dependencies = ["pytest"]
`,
    "/w/uv.lock": "",
    "/w/.venv/bin/python": "",
    "/w/.venv/bin/pytest": "#!/w/.venv/bin/python\n",
    "/w/.venv/bin/mypy": "#!/usr/bin/env python\n",
};

/** A Poetry project whose `.venv` also holds `pip`. */
const POETRY_VENV = {
    "/w/pyproject.toml": `[tool.poetry]
name = "api"
version = "0.1.0"
`,
    "/w/poetry.lock": "",
    "/w/.venv/pyvenv.cfg": "home = /usr/bin\n",
    "/w/.venv/bin/python": "",
    "/w/.venv/bin/pip": "#!/w/.venv/bin/python\n",
};

/** A project with a plain `venv/` directory. */
const VENV_BIN = {
    "/w/pyproject.toml": `[project]
name = "api"
version = "0.1.0"
`,
    "/w/venv/pyvenv.cfg": "",
    "/w/venv/bin/python": "",
    "/w/venv/bin/pytest": "#!/w/venv/bin/python\n",
};

describe("venv executables are never rewritten", () => {
    test(".venv/bin console scripts in a uv project", () => {
        expect(given(UV_VENV).at("/w").run(".venv/bin/pytest", "-q")).toEqual(kept);
        expect(given(UV_VENV).at("/w").run(".venv/bin/mypy", ".")).toEqual(kept);
    });

    test("a `venv/bin` interpreter and console script", () => {
        expect(given(VENV_BIN).at("/w").run("venv/bin/python", "x.py")).toEqual(kept);
        expect(given(VENV_BIN).at("/w").run("venv/bin/pytest", "-q")).toEqual(kept);
    });

    test("a relative path into the venv from a sub-directory", () => {
        expect(given(UV_VENV).at("/w/api").run("../.venv/bin/mypy", ".")).toEqual(kept);
    });

    test("an absolute venv path recognized by pyvenv.cfg", () => {
        const files = {
            "/opt/venvs/thing/pyvenv.cfg": "",
            "/opt/venvs/thing/bin/python": "",
            "/opt/venvs/thing/bin/pytest": "#!/opt/venvs/thing/bin/python\n",
        };
        expect(given(files).at("/w").run("/opt/venvs/thing/bin/pytest", "-q")).toEqual(
            kept,
        );
    });

    test("pip inside the venv is not turned into a manager command", () => {
        expect(
            given(POETRY_VENV).at("/w").run(".venv/bin/pip", "install", "x"),
        ).toEqual(kept);
    });
});
