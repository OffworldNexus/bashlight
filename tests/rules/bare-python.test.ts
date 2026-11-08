import { describe, expect, test } from "bun:test";

import { PIP_OUTSIDE_PROJECT_MESSAGE } from "../../src/rules/builtin/bare-python.ts";
import { POETRY_PROJECT } from "./fixtures.ts";
import { blocked, given, kept, rewritten, UNKNOWN } from "./harness.ts";

describe("bare-python — uv forward", () => {
    test("script file becomes uv run script", () => {
        expect(given().run("python", "script.py", "--flag")).toEqual(
            rewritten(["uv", "run", "script.py", "--flag"]),
        );
        expect(given().run("python3", "./tools/generate.py")).toEqual(
            rewritten(["uv", "run", "./tools/generate.py"]),
        );
    });

    test("anything else keeps the interpreter", () => {
        expect(given().run("python", "-c", "print(1)")).toEqual(
            rewritten(["uv", "run", "python", "-c", "print(1)"]),
        );
        expect(given().run("python", "-m", "pytest")).toEqual(
            rewritten(["uv", "run", "python", "-m", "pytest"]),
        );
        expect(given().run("python")).toEqual(rewritten(["uv", "run", "python"]));
    });

    test("python3.N is forwarded with --python", () => {
        expect(given().run("python3.12", "script.py")).toEqual(
            rewritten(["uv", "run", "--python", "3.12", "script.py"]),
        );
        expect(given().run("python3.12", "-m", "pytest")).toEqual(
            rewritten(["uv", "run", "--python", "3.12", "python", "-m", "pytest"]),
        );
    });
});

describe("bare-python — pip", () => {
    test("pip install is blocked with guidance", () => {
        expect(given().run("pip", "install", "requests")).toEqual(
            blocked(PIP_OUTSIDE_PROJECT_MESSAGE),
        );
        expect(given().run("pip3", "install", "-r", "requirements.txt")).toEqual(
            blocked(PIP_OUTSIDE_PROJECT_MESSAGE),
        );
        expect(given().run("python", "-m", "pip", "install", "requests")).toEqual(
            blocked(PIP_OUTSIDE_PROJECT_MESSAGE),
        );
    });

    test("read-only pip subcommands are kept", () => {
        expect(given().run("pip", "list")).toEqual(kept);
        expect(given().run("pip", "freeze")).toEqual(kept);
        expect(given().run("pip", UNKNOWN)).toEqual(kept);
    });
});

describe("bare-python — guards", () => {
    test("does nothing inside a project", () => {
        expect(given(POETRY_PROJECT).run("python", "script.py")).toEqual(
            rewritten(["poetry", "run", "python", "script.py"]),
        );
    });

    test("does nothing with an active venv", () => {
        expect(given().env({ VIRTUAL_ENV: "/x" }).run("python", "x.py")).toEqual(kept);
        expect(given().env({ VIRTUAL_ENV: "/x" }).run("pip", "install", "x")).toEqual(
            kept,
        );
    });

    test("never touches venv creation", () => {
        expect(given().run("python", "-m", "venv", ".venv")).toEqual(kept);
    });

    test("leaves a manager runner alone", () => {
        expect(given().run("uv", "run", "python", "x.py")).toEqual(kept);
    });

    test("leaves explicit paths alone", () => {
        expect(given().run(".venv/bin/python", "x.py")).toEqual(kept);
        expect(given().run("/usr/bin/python3", "x.py")).toEqual(kept);
    });
});

describe("bare-python — scripts", () => {
    test("a python-shebang script runs under uv", () => {
        expect(
            given({ "/w/tool": "#!/usr/bin/env python3\n" })
                .at("/w")
                .run("./tool", "--flag"),
        ).toEqual(rewritten(["uv", "run", "./tool", "--flag"]));
        expect(
            given({ "/w/tool": "#!/usr/bin/python3\n" }).at("/w").run("./tool"),
        ).toEqual(rewritten(["uv", "run", "python", "./tool"]));
    });

    test("a script already using uv is kept", () => {
        expect(
            given({ "/w/tool": "#!/usr/bin/env -S uv run --script\n" })
                .at("/w")
                .run("./tool"),
        ).toEqual(kept);
    });

    test("non-python and missing scripts are kept", () => {
        expect(given({ "/w/tool": "#!/bin/bash\n" }).at("/w").run("./tool")).toEqual(
            kept,
        );
        expect(
            given({ "/w/tool": "#!/usr/bin/env poetry run python\n" })
                .at("/w")
                .run("./tool"),
        ).toEqual(kept);
        expect(given({}).at("/w").run("./tool")).toEqual(kept);
    });
});
