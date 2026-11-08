import { describe, expect, test } from "bun:test";

import { PIP_OUTSIDE_PROJECT_MESSAGE } from "../../src/rules/builtin/bare-python.ts";
import { REMOVE_REASON } from "../../src/rules/builtin/pip-to-manager.ts";
import {
    HATCH_PROJECT,
    PDM_PROJECT,
    PIPENV_PROJECT,
    POETRY_PROJECT,
    UV_PROJECT,
    VENV_PROJECT,
} from "./fixtures.ts";
import { blocked, given, kept, rewritten, UNKNOWN } from "./harness.ts";

describe("pip-to-manager — poetry", () => {
    test("install package", () => {
        expect(given(POETRY_PROJECT).run("pip", "install", "requests")).toEqual(
            rewritten(["poetry", "add", "requests"]),
        );
        expect(given(POETRY_PROJECT).run("pip3", "install", "requests")).toEqual(
            rewritten(["poetry", "add", "requests"]),
        );
        expect(
            given(POETRY_PROJECT).run("python", "-m", "pip", "install", "requests"),
        ).toEqual(rewritten(["poetry", "add", "requests"]));
        expect(
            given(POETRY_PROJECT).run("poetry", "run", "pip", "install", "requests"),
        ).toEqual(rewritten(["poetry", "add", "requests"]));
    });

    test("multiple package specs and unknown values pass by reference", () => {
        expect(
            given(POETRY_PROJECT).run("pip", "install", "requests", "httpx"),
        ).toEqual(rewritten(["poetry", "add", "requests", "httpx"]));
        expect(given(POETRY_PROJECT).run("pip", "install", UNKNOWN)).toEqual(
            rewritten(["poetry", "add", UNKNOWN]),
        );
    });

    test("upgrade appends @latest only without a constraint", () => {
        expect(given(POETRY_PROJECT).run("pip", "install", "-U", "requests")).toEqual(
            rewritten(["poetry", "add", "requests@latest"]),
        );
        expect(
            given(POETRY_PROJECT).run("pip", "install", "--upgrade", "requests==2.0"),
        ).toEqual(rewritten(["poetry", "add", "requests==2.0"]));
    });

    test("editable/project install becomes a plain install", () => {
        expect(given(POETRY_PROJECT).run("pip", "install", "-e", ".")).toEqual(
            rewritten(["poetry", "install"]),
        );
        expect(given(POETRY_PROJECT).run("pip", "install", ".")).toEqual(
            rewritten(["poetry", "install"]),
        );
        expect(given(POETRY_PROJECT).run("pip", "install")).toEqual(
            rewritten(["poetry", "install"]),
        );
    });

    test("an editable path that is not the project keeps pip under the runner", () => {
        expect(given(POETRY_PROJECT).run("pip", "install", "-e", "./lib")).toEqual(
            rewritten(["poetry", "run", "pip", "install", "-e", "./lib"]),
        );
        expect(given(UV_PROJECT).run("pip", "install", "-e", "./lib")).toEqual(
            rewritten(["uv", "pip", "install", "-e", "./lib"]),
        );
    });

    test("requirements keep pip under the runner", () => {
        expect(
            given(POETRY_PROJECT).run("pip", "install", "-r", "requirements.txt"),
        ).toEqual(
            rewritten(["poetry", "run", "pip", "install", "-r", "requirements.txt"]),
        );
    });

    test("uninstall becomes remove", () => {
        expect(given(POETRY_PROJECT).run("pip", "uninstall", "requests", "-y")).toEqual(
            rewritten(["poetry", "remove", "requests"]),
        );
    });

    test("read-only subcommands run in the env", () => {
        expect(given(POETRY_PROJECT).run("pip", "list")).toEqual(
            rewritten(["poetry", "run", "pip", "list"]),
        );
        expect(given(POETRY_PROJECT).run("pip", "show", "requests")).toEqual(
            rewritten(["poetry", "run", "pip", "show", "requests"]),
        );
    });

    test("unknown flags fall back to pip under the runner, dropping --user", () => {
        expect(
            given(POETRY_PROJECT).run("pip", "install", "--index-url", "U", "requests"),
        ).toEqual(
            rewritten([
                "poetry",
                "run",
                "pip",
                "install",
                "--index-url",
                "U",
                "requests",
            ]),
        );
        expect(
            given(POETRY_PROJECT).run("pip", "install", "--user", "requests"),
        ).toEqual(rewritten(["poetry", "add", "requests"]));
        expect(
            given(POETRY_PROJECT).run("pip", "install", "--break-system-packages", "x"),
        ).toEqual(rewritten(["poetry", "add", "x"]));
    });

    test("a wrong runner is replaced by the project manager", () => {
        expect(
            given(UV_PROJECT).run("poetry", "run", "pip", "install", "requests"),
        ).toEqual(rewritten(["uv", "add", "requests"]));
    });
});

describe("pip-to-manager — uv", () => {
    test("install package", () => {
        expect(given(UV_PROJECT).run("pip", "install", "requests")).toEqual(
            rewritten(["uv", "add", "requests"]),
        );
    });

    test("upgrade uses --upgrade-package", () => {
        expect(given(UV_PROJECT).run("pip", "install", "-U", "requests")).toEqual(
            rewritten(["uv", "add", "requests", "--upgrade-package", "requests"]),
        );
    });

    test("editable project becomes uv sync; requirements use uv add -r", () => {
        expect(given(UV_PROJECT).run("pip", "install", "-e", ".")).toEqual(
            rewritten(["uv", "sync"]),
        );
        expect(
            given(UV_PROJECT).run("pip", "install", "-r", "requirements.txt"),
        ).toEqual(rewritten(["uv", "add", "-r", "requirements.txt"]));
    });

    test("uninstall and read-only commands", () => {
        expect(given(UV_PROJECT).run("pip", "uninstall", "requests")).toEqual(
            rewritten(["uv", "remove", "requests"]),
        );
        expect(given(UV_PROJECT).run("pip", "list")).toEqual(
            rewritten(["uv", "pip", "list"]),
        );
    });

    test("unknown flags use uv pip", () => {
        expect(
            given(UV_PROJECT).run("pip", "install", "--index-url", "U", "requests"),
        ).toEqual(rewritten(["uv", "pip", "install", "--index-url", "U", "requests"]));
    });
});

describe("pip-to-manager — pipenv and pdm", () => {
    test("pipenv install/remove/read-only", () => {
        expect(given(PIPENV_PROJECT).run("pip", "install", "requests")).toEqual(
            rewritten(["pipenv", "install", "requests"]),
        );
        expect(given(PIPENV_PROJECT).run("pip", "install", "-e", ".")).toEqual(
            rewritten(["pipenv", "install", "-e", "."]),
        );
        expect(
            given(PIPENV_PROJECT).run("pip", "install", "-r", "requirements.txt"),
        ).toEqual(rewritten(["pipenv", "install", "-r", "requirements.txt"]));
        expect(given(PIPENV_PROJECT).run("pip", "uninstall", "requests")).toEqual(
            rewritten(["pipenv", "uninstall", "requests"]),
        );
        expect(given(PIPENV_PROJECT).run("pip", "list")).toEqual(
            rewritten(["pipenv", "run", "pip", "list"]),
        );
    });

    test("pdm install/remove/read-only", () => {
        expect(given(PDM_PROJECT).run("pip", "install", "requests")).toEqual(
            rewritten(["pdm", "add", "requests"]),
        );
        expect(given(PDM_PROJECT).run("pip", "install", "-e", ".")).toEqual(
            rewritten(["pdm", "install"]),
        );
        expect(
            given(PDM_PROJECT).run("pip", "install", "-r", "requirements.txt"),
        ).toEqual(
            rewritten(["pdm", "run", "pip", "install", "-r", "requirements.txt"]),
        );
        expect(given(PDM_PROJECT).run("pip", "uninstall", "requests")).toEqual(
            rewritten(["pdm", "remove", "requests"]),
        );
        expect(given(PDM_PROJECT).run("pip", "list")).toEqual(
            rewritten(["pdm", "run", "pip", "list"]),
        );
    });
});

describe("pip-to-manager — not applicable", () => {
    test("hatch and venv are left to python-runner", () => {
        expect(given(HATCH_PROJECT).run("pip", "install", "requests")).toEqual(kept);
        expect(given(VENV_PROJECT).run("pip", "install", "requests")).toEqual(kept);
    });

    test("no project is blocked by bare-python", () => {
        expect(given().run("pip", "install", "requests")).toEqual(
            blocked(PIP_OUTSIDE_PROJECT_MESSAGE),
        );
    });

    test("explicit pip paths are left alone", () => {
        expect(given(POETRY_PROJECT).run(".venv/bin/pip", "install", "x")).toEqual(
            kept,
        );
        expect(given(POETRY_PROJECT).run("/usr/bin/pip", "install", "x")).toEqual(kept);
    });

    test("an unknown pip subcommand is wrapped by python-runner", () => {
        expect(given(POETRY_PROJECT).run("pip", UNKNOWN, "x")).toEqual(
            rewritten(["poetry", "run", "pip", UNKNOWN, "x"]),
        );
    });
});

describe("pip-to-manager — runner with options", () => {
    test("a manager runner carrying options is kept", () => {
        expect(
            given(POETRY_PROJECT).run(
                "poetry",
                "-C",
                "api",
                "run",
                "pip",
                "install",
                "requests",
            ),
        ).toEqual(kept);
        expect(
            given(POETRY_PROJECT).run(
                "poetry",
                "--directory",
                "api",
                "run",
                "pip",
                "install",
                "requests",
            ),
        ).toEqual(kept);
        expect(
            given(UV_PROJECT).run(
                "uv",
                "run",
                "--directory",
                "api",
                "pip",
                "install",
                "requests",
            ),
        ).toEqual(kept);
        expect(
            given(UV_PROJECT).run(
                "uv",
                "run",
                "--project",
                "api",
                "pip",
                "install",
                "requests",
            ),
        ).toEqual(kept);
        expect(
            given(UV_PROJECT).run(
                "uv",
                "run",
                "--python",
                "3.12",
                "pip",
                "install",
                "requests",
            ),
        ).toEqual(kept);
    });
});

describe("pip-to-manager — prereleases and tooling", () => {
    test("--pre becomes the manager's prerelease flag", () => {
        expect(
            given(POETRY_PROJECT).run("pip", "install", "--pre", "requests"),
        ).toEqual(rewritten(["poetry", "add", "--allow-prereleases", "requests"]));
        expect(given(UV_PROJECT).run("pip", "install", "--pre", "requests")).toEqual(
            rewritten(["uv", "add", "--prerelease", "allow", "requests"]),
        );
        expect(
            given(PIPENV_PROJECT).run("pip", "install", "--pre", "requests"),
        ).toEqual(rewritten(["pipenv", "install", "--pre", "requests"]));
        expect(given(PDM_PROJECT).run("pip", "install", "--pre", "requests")).toEqual(
            rewritten(["pdm", "add", "--pre", "requests"]),
        );
    });

    test("installer tooling is run in the env, never added", () => {
        expect(given(POETRY_PROJECT).run("pip", "install", "-U", "pip")).toEqual(
            rewritten(["poetry", "run", "pip", "install", "-U", "pip"]),
        );
        expect(given(UV_PROJECT).run("pip", "install", "-U", "pip")).toEqual(
            rewritten(["uv", "pip", "install", "-U", "pip"]),
        );
        expect(
            given(PIPENV_PROJECT).run("pip", "install", "setuptools", "wheel"),
        ).toEqual(
            rewritten(["pipenv", "run", "pip", "install", "setuptools", "wheel"]),
        );
    });

    test("multiple -r and local paths", () => {
        expect(
            given(UV_PROJECT).run("pip", "install", "-r", "a.txt", "-r", "b.txt"),
        ).toEqual(rewritten(["uv", "add", "-r", "a.txt", "-r", "b.txt"]));
        expect(
            given(POETRY_PROJECT).run("pip", "install", "-r", "a.txt", "-r", "b.txt"),
        ).toEqual(
            rewritten([
                "poetry",
                "run",
                "pip",
                "install",
                "-r",
                "a.txt",
                "-r",
                "b.txt",
            ]),
        );
        expect(given(POETRY_PROJECT).run("pip", "install", "./lib")).toEqual(
            rewritten(["poetry", "run", "pip", "install", "./lib"]),
        );
    });
});

describe("pip-to-manager — reasons", () => {
    test("the harness records the applied rule and reason", () => {
        const harness = given(POETRY_PROJECT);
        harness.run("pip", "uninstall", "requests");
        expect(harness.applied).toEqual([
            { ruleId: "pip-to-manager", reason: REMOVE_REASON },
        ]);
    });
});
