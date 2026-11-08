import { describe, expect, test } from "bun:test";

import {
    HATCH_PROJECT,
    PIPENV_PROJECT,
    POETRY_PROJECT,
    UV_PROJECT,
    VENV_PROJECT,
} from "./fixtures.ts";
import { given, kept, rewritten } from "./harness.ts";

describe("python-runner — bare tools", () => {
    test("wraps a bare interpreter", () => {
        expect(given(POETRY_PROJECT).run("python", "script.py")).toEqual(
            rewritten(["poetry", "run", "python", "script.py"]),
        );
        expect(given(POETRY_PROJECT).run("python3", "-c", "print(1)")).toEqual(
            rewritten(["poetry", "run", "python3", "-c", "print(1)"]),
        );
        expect(given(POETRY_PROJECT).run("python")).toEqual(
            rewritten(["poetry", "run", "python"]),
        );
    });

    test("wraps a declared project tool", () => {
        expect(given(POETRY_PROJECT).run("pytest", "-q")).toEqual(
            rewritten(["poetry", "run", "pytest", "-q"]),
        );
    });

    test("leaves an undeclared tool alone", () => {
        expect(given(POETRY_PROJECT).run("ruff", "check", ".")).toEqual(kept);
    });

    test("wraps python -m and keeps the module", () => {
        expect(given(POETRY_PROJECT).run("python", "-m", "pytest")).toEqual(
            rewritten(["poetry", "run", "python", "-m", "pytest"]),
        );
    });

    test("never wraps venv/ virtualenv creation", () => {
        expect(given(POETRY_PROJECT).run("python", "-m", "venv", ".venv")).toEqual(
            kept,
        );
        expect(
            given(POETRY_PROJECT).run("python", "-m", "virtualenv", ".venv"),
        ).toEqual(kept);
    });
});

describe("python-runner — runners", () => {
    test("keeps the correct runner", () => {
        expect(given(POETRY_PROJECT).run("poetry", "run", "pytest")).toEqual(kept);
    });

    test("swaps a wrong runner", () => {
        expect(given(UV_PROJECT).run("poetry", "run", "pytest")).toEqual(
            rewritten(["uv", "run", "pytest"]),
        );
        expect(given(POETRY_PROJECT).run("uv", "run", "pytest")).toEqual(
            rewritten(["poetry", "run", "pytest"]),
        );
    });

    test("does not swap a runner carrying options", () => {
        expect(given(POETRY_PROJECT).run("uv", "run", "--with", "x", "pytest")).toEqual(
            kept,
        );
    });

    test("hatch runs commands through hatch run", () => {
        expect(given(HATCH_PROJECT).run("python", "script.py")).toEqual(
            rewritten(["hatch", "run", "python", "script.py"]),
        );
    });
});

describe("python-runner — venv", () => {
    test("replaces the interpreter with the venv path (relative to cwd)", () => {
        expect(given(VENV_PROJECT).at("/w").run("python", "script.py")).toEqual(
            rewritten([".venv/bin/python", "script.py"]),
        );
        expect(given(VENV_PROJECT).at("/w/src").run("python3.12", "a.py")).toEqual(
            rewritten(["../.venv/bin/python", "a.py"]),
        );
        expect(given(VENV_PROJECT).at("/w").run("python3", "a.py")).toEqual(
            rewritten([".venv/bin/python3", "a.py"]),
        );
        expect(given(VENV_PROJECT).at("/w").run("pip", "list")).toEqual(
            rewritten([".venv/bin/pip", "list"]),
        );
    });
});

describe("python-runner — guards", () => {
    test("leaves bare python to bare-python without a project", () => {
        expect(given().run("pytest")).toEqual(kept);
        expect(given().run("python", "x.py")).toEqual(rewritten(["uv", "run", "x.py"]));
    });

    test("does nothing when a venv is active", () => {
        expect(
            given(POETRY_PROJECT).env({ VIRTUAL_ENV: "/w/.venv" }).run("pytest"),
        ).toEqual(kept);
        expect(
            given(POETRY_PROJECT)
                .env({ VIRTUAL_ENV: "/w/.venv" })
                .run("python", "x.py"),
        ).toEqual(kept);
        expect(
            given(POETRY_PROJECT).env({ CONDA_PREFIX: "/opt/conda" }).run("pytest"),
        ).toEqual(kept);
    });

    test("leaves explicit paths alone", () => {
        expect(given(POETRY_PROJECT).run(".venv/bin/python", "x.py")).toEqual(kept);
        expect(given(POETRY_PROJECT).run("/usr/bin/python3", "x.py")).toEqual(kept);
        expect(given(POETRY_PROJECT).run("./scripts/run.py")).toEqual(kept);
    });

    test("does not fight pip-to-manager", () => {
        expect(given(POETRY_PROJECT).run("pip", "install", "requests")).toEqual(
            rewritten(["poetry", "add", "requests"]),
        );
        expect(
            given(POETRY_PROJECT).run("poetry", "run", "pip", "install", "x"),
        ).toEqual(rewritten(["poetry", "add", "x"]));
    });
});

const ENV_PY = "#!/usr/bin/env python3\n";
const ABS_PY = "#!/usr/bin/python3\n";
const UV_SHEBANG = "#!/usr/bin/env -S uv run --script\n";

describe("python-runner — scripts", () => {
    test("an env python shebang prefixes the project runner", () => {
        expect(
            given({ ...POETRY_PROJECT, "/w/manage.py": ENV_PY })
                .at("/w")
                .run("./manage.py", "migrate"),
        ).toEqual(rewritten(["poetry", "run", "./manage.py", "migrate"]));
        expect(
            given({ ...UV_PROJECT, "/w/manage.py": ENV_PY })
                .at("/w")
                .run("./manage.py", "migrate"),
        ).toEqual(rewritten(["uv", "run", "./manage.py", "migrate"]));
        expect(
            given({ ...PIPENV_PROJECT, "/w/manage.py": ENV_PY })
                .at("/w")
                .run("./manage.py"),
        ).toEqual(rewritten(["pipenv", "run", "./manage.py"]));
    });

    test("an absolute interpreter inserts python explicitly", () => {
        expect(
            given({ ...POETRY_PROJECT, "/w/manage.py": ABS_PY })
                .at("/w")
                .run("./manage.py", "migrate"),
        ).toEqual(rewritten(["poetry", "run", "python", "./manage.py", "migrate"]));
    });

    test("the venv manager uses the venv interpreter", () => {
        expect(
            given({ ...VENV_PROJECT, "/w/manage.py": "#!/usr/bin/env python\n" })
                .at("/w")
                .run("./manage.py"),
        ).toEqual(rewritten([".venv/bin/python", "./manage.py"]));
    });

    test("resolves the script against the command's cwd", () => {
        expect(
            given({ ...POETRY_PROJECT, "/w/api/manage.py": ENV_PY })
                .at("/w/api")
                .run("./manage.py"),
        ).toEqual(rewritten(["poetry", "run", "./manage.py"]));
        expect(
            given({ ...POETRY_PROJECT, "/w/manage.py": ENV_PY })
                .at("/w/api")
                .run("../manage.py"),
        ).toEqual(rewritten(["poetry", "run", "../manage.py"]));
    });

    test("a shebang already using a runner is swapped, or kept when equal", () => {
        expect(
            given({ ...UV_PROJECT, "/w/script": UV_SHEBANG })
                .at("/w")
                .run("./script"),
        ).toEqual(kept);
        expect(
            given({ ...POETRY_PROJECT, "/w/script": UV_SHEBANG })
                .at("/w")
                .run("./script"),
        ).toEqual(rewritten(["poetry", "run", "./script"]));
    });

    test("non-python, missing scripts and guards are kept", () => {
        expect(
            given({ ...POETRY_PROJECT, "/w/x": "#!/bin/bash\n" })
                .at("/w")
                .run("./x"),
        ).toEqual(kept);
        expect(given(POETRY_PROJECT).at("/w").run("./missing.py")).toEqual(kept);
        expect(
            given({ ...POETRY_PROJECT, "/w/m.py": ENV_PY })
                .at(undefined)
                .run("./m.py"),
        ).toEqual(kept);
        expect(
            given({ ...POETRY_PROJECT, "/w/m.py": ENV_PY })
                .env({ VIRTUAL_ENV: "/w/.venv" })
                .at("/w")
                .run("./m.py"),
        ).toEqual(kept);
    });
});
