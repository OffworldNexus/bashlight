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
            rewritten(["uv", "run", "--with", "pytest", "python", "-m", "pytest"]),
        );
        expect(given().run("python")).toEqual(rewritten(["uv", "run", "python"]));
    });

    test("python3.N is forwarded with --python", () => {
        expect(given().run("python3.12", "script.py")).toEqual(
            rewritten(["uv", "run", "--python", "3.12", "script.py"]),
        );
        expect(given().run("python3.12", "-m", "pytest")).toEqual(
            rewritten([
                "uv",
                "run",
                "--python",
                "3.12",
                "--with",
                "pytest",
                "python",
                "-m",
                "pytest",
            ]),
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

describe("bare-python — import-aware", () => {
    test("probing a third-party module adds --with", () => {
        expect(given().run("python3", "-c", "import cairosvg")).toEqual(
            rewritten([
                "uv",
                "run",
                "--with",
                "cairosvg",
                "python",
                "-c",
                "import cairosvg",
            ]),
        );
    });

    test("stdlib imports add nothing", () => {
        const code = "import os, json\nfrom pathlib import Path";
        expect(given().run("python", "-c", code)).toEqual(
            rewritten(["uv", "run", "python", "-c", code]),
        );
    });

    test("several modules become several --with in first-seen order", () => {
        const code = "import requests\nfrom bs4 import BeautifulSoup";
        expect(given().run("python", "-c", code)).toEqual(
            rewritten([
                "uv",
                "run",
                "--with",
                "requests",
                "--with",
                "beautifulsoup4",
                "python",
                "-c",
                code,
            ]),
        );
    });

    test("distribution mismatches are mapped", () => {
        expect(given().run("python", "-c", "from PIL import Image")).toEqual(
            rewritten([
                "uv",
                "run",
                "--with",
                "pillow",
                "python",
                "-c",
                "from PIL import Image",
            ]),
        );
        expect(given().run("python", "-c", "import cv2, yaml")).toEqual(
            rewritten([
                "uv",
                "run",
                "--with",
                "opencv-python",
                "--with",
                "pyyaml",
                "python",
                "-c",
                "import cv2, yaml",
            ]),
        );
    });

    test("local modules are not downloaded", () => {
        const files = { "/w/helpers.py": "", "/w/mypkg/__init__.py": "" };
        expect(given(files).run("python", "-c", "import helpers, mypkg")).toEqual(
            rewritten(["uv", "run", "python", "-c", "import helpers, mypkg"]),
        );
    });

    test("a script file is read for its imports", () => {
        expect(
            given({ "/w/probe.py": "import cairosvg\nprint('ok')\n" })
                .at("/w")
                .run("python", "probe.py"),
        ).toEqual(rewritten(["uv", "run", "--with", "cairosvg", "probe.py"]));
    });

    test("a PEP 723 script is left to uv", () => {
        const script =
            '# /// script\n# dependencies = ["cairosvg"]\n# ///\nimport cairosvg\n';
        expect(
            given({ "/w/probe.py": script }).at("/w").run("python", "probe.py"),
        ).toEqual(rewritten(["uv", "run", "probe.py"]));
    });

    test("a missing script keeps the plain run", () => {
        expect(given().at("/w").run("python", "nope.py")).toEqual(
            rewritten(["uv", "run", "nope.py"]),
        );
    });

    test("stdin code is scanned", () => {
        expect(given().stdin("import cairosvg\nprint(1)\n").run("python", "-")).toEqual(
            rewritten(["uv", "run", "--with", "cairosvg", "python", "-"]),
        );
    });

    test("a third-party -m module gets --with", () => {
        expect(given().run("python", "-m", "black")).toEqual(
            rewritten(["uv", "run", "--with", "black", "python", "-m", "black"]),
        );
    });

    test("a stdlib -m module keeps no --with", () => {
        expect(given().run("python", "-m", "http.server")).toEqual(
            rewritten(["uv", "run", "python", "-m", "http.server"]),
        );
    });

    test("past the cap the plain run is kept", () => {
        const modules = Array.from({ length: 11 }, (_, index) => `pkg${index}`);
        const code = `import ${modules.join(", ")}`;
        expect(given().run("python", "-c", code)).toEqual(
            rewritten(["uv", "run", "python", "-c", code]),
        );
    });

    test("levenshtein and other mapped names are used as distributions", () => {
        expect(given().run("python", "-c", "import Levenshtein")).toEqual(
            rewritten([
                "uv",
                "run",
                "--with",
                "levenshtein",
                "python",
                "-c",
                "import Levenshtein",
            ]),
        );
    });
});
