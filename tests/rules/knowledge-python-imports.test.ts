import { describe, expect, test } from "bun:test";

import {
    distributionFor,
    hasPep723Block,
    isStdlibModule,
    PythonImportScanner,
} from "../../src/rules/knowledge/python-imports.ts";

const scanner = new PythonImportScanner();

function scan(code: string): readonly string[] {
    return scanner.scan(code);
}

describe("PythonImportScanner", () => {
    test("plain imports, dotted and aliased", () => {
        expect(scan("import a")).toEqual(["a"]);
        expect(scan("import a.b.c")).toEqual(["a"]);
        expect(scan("import a.b as c, d")).toEqual(["a", "d"]);
        expect(scan("import numpy as np")).toEqual(["numpy"]);
    });

    test("from-imports keep only the module", () => {
        expect(scan("from a.b import (x, y)")).toEqual(["a"]);
        expect(scan("from a import b as c")).toEqual(["a"]);
        expect(scan("from a import *")).toEqual(["a"]);
    });

    test("relative imports are local and ignored", () => {
        expect(scan("from . import x")).toEqual([]);
        expect(scan("from .a import x")).toEqual([]);
        expect(scan("from ..a.b import x")).toEqual([]);
    });

    test("dynamic imports", () => {
        expect(scan('__import__("a")')).toEqual(["a"]);
        expect(scan('__import__("a.b")')).toEqual(["a"]);
        expect(scan('importlib.import_module("a.b")')).toEqual(["a"]);
        expect(scan("importlib.import_module('a')")).toEqual(["a"]);
    });

    test("comments are stripped", () => {
        expect(scan("# import a\nimport b  # import c")).toEqual(["b"]);
    });

    test("imports inside strings are ignored", () => {
        expect(scan('s = "import a"')).toEqual([]);
        expect(scan("s = 'from a import b'")).toEqual([]);
    });

    test("triple-quoted blocks are skipped", () => {
        expect(scan('"""\nimport a\n"""\nimport b')).toEqual(["b"]);
        expect(scan('x = """import a\nstill a string"""\nimport c')).toEqual(["c"]);
    });

    test("semicolon-joined one-liners", () => {
        expect(scan("x = 1; import a; import b")).toEqual(["a", "b"]);
        expect(scan("import a; print(1)")).toEqual(["a"]);
    });

    test("compound one-liners with a colon", () => {
        expect(scan("if True: import a")).toEqual(["a"]);
    });

    test("first-seen order, deduplicated", () => {
        expect(scan("import b, a\nimport b")).toEqual(["b", "a"]);
        expect(scan("from a import x\nimport a")).toEqual(["a"]);
    });

    test("a parenthesized multi-line from-import", () => {
        expect(scan("from a import (\n    x,\n    y,\n)")).toEqual(["a"]);
    });

    test("empty and unreadable input", () => {
        expect(scan("")).toEqual([]);
        expect(scan("x = 1")).toEqual([]);
    });
});

describe("isStdlibModule", () => {
    test("standard library modules", () => {
        expect(isStdlibModule("os")).toBe(true);
        expect(isStdlibModule("json")).toBe(true);
        expect(isStdlibModule("http")).toBe(true);
        expect(isStdlibModule("sqlite3")).toBe(true);
    });

    test("private and dunder modules count as stdlib", () => {
        expect(isStdlibModule("_abc")).toBe(true);
        expect(isStdlibModule("__future__")).toBe(true);
    });

    test("third-party modules do not", () => {
        expect(isStdlibModule("cairosvg")).toBe(false);
        expect(isStdlibModule("yaml")).toBe(false);
        expect(isStdlibModule("numpy")).toBe(false);
    });
});

describe("distributionFor", () => {
    test("well-known import → distribution mismatches", () => {
        expect(distributionFor("yaml")).toBe("pyyaml");
        expect(distributionFor("PIL")).toBe("pillow");
        expect(distributionFor("cv2")).toBe("opencv-python");
        expect(distributionFor("bs4")).toBe("beautifulsoup4");
        expect(distributionFor("sklearn")).toBe("scikit-learn");
        expect(distributionFor("dateutil")).toBe("python-dateutil");
        expect(distributionFor("Crypto")).toBe("pycryptodome");
        expect(distributionFor("Levenshtein")).toBe("levenshtein");
        expect(distributionFor("slugify")).toBe("python-slugify");
    });

    test("identity entries are listed explicitly", () => {
        expect(distributionFor("requests")).toBe("requests");
        expect(distributionFor("numpy")).toBe("numpy");
        expect(distributionFor("httpx")).toBe("httpx");
        expect(distributionFor("django")).toBe("django");
    });

    test("unknown and ambiguous names are skipped", () => {
        expect(distributionFor("google")).toBeUndefined();
        expect(distributionFor("mysterylib")).toBeUndefined();
        expect(distributionFor("projecthelpers")).toBeUndefined();
    });
});

describe("hasPep723Block", () => {
    test("a script block is detected", () => {
        expect(
            hasPep723Block('# /// script\n# dependencies = ["x"]\n# ///\nimport x'),
        ).toBe(true);
    });

    test("anything else is not", () => {
        expect(hasPep723Block("# /// other\nimport x")).toBe(false);
        expect(hasPep723Block("import x")).toBe(false);
    });
});
