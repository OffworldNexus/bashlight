import { describe, expect, test } from "bun:test";

import { TomlDocument } from "../../src/project/toml-reader.ts";

describe("TomlDocument", () => {
    test("reads sections, dotted keys and multi-line arrays", () => {
        const doc = TomlDocument.parse(`
[project]
name = "api"
dependencies = [
    "fastapi>=0.110",
    "requests",
]

[project.optional-dependencies]
dev = ["pytest", "ruff"]
docs = ["mkdocs"]

[tool.poetry.dependencies]
python = "^3.12"
httpx = "^0.27"
`);
        expect(doc.get(["project", "name"])).toBe("api");
        expect(doc.stringList(["project", "dependencies"])).toEqual([
            "fastapi>=0.110",
            "requests",
        ]);
        expect(doc.childKeys(["project", "optional-dependencies"])).toEqual([
            "dev",
            "docs",
        ]);
        expect(doc.stringList(["project", "optional-dependencies", "dev"])).toEqual([
            "pytest",
            "ruff",
        ]);
        expect(doc.hasTable(["tool", "poetry"])).toBe(true);
        expect(doc.hasTable(["tool", "poetry", "dependencies"])).toBe(true);
        expect(doc.hasTable(["nope"])).toBe(false);
        expect(doc.get(["tool", "poetry", "dependencies", "python"])).toBe("^3.12");
    });

    test("reads arrays of tables and tables nested in the last element", () => {
        const doc = TomlDocument.parse(`
[[package]]
name = "certifi"
version = "2024.2.2"

[package.dependencies]
requests = ">=2"

[[package]]
name = "charset-normalizer"
`);
        const packages = doc.tables(["package"]);
        expect(packages).toHaveLength(2);
        expect(packages[0]?.["name"]).toBe("certifi");
        expect(packages[1]?.["name"]).toBe("charset-normalizer");
    });

    test("tables() also returns a single plain table", () => {
        const doc = TomlDocument.parse(`
[package]
name = "solo"
version = "1.0.0"
`);
        const packages = doc.tables(["package"]);
        expect(packages).toHaveLength(1);
        expect(packages[0]?.["name"]).toBe("solo");
        expect(doc.tables(["missing"])).toEqual([]);
    });

    test("reads inline tables inside arrays", () => {
        const doc = TomlDocument.parse(`
[[package]]
name = "anyio"
dependencies = [
    { name = "idna" },
    { name = "sniffio" },
]
`);
        const dependencies = doc.get(["package"]);
        expect(Array.isArray(dependencies)).toBe(true);
        const first = doc.tables(["package"])[0];
        expect(Array.isArray(first?.["dependencies"])).toBe(true);
    });

    test("reads literal/basic strings, escapes, numbers and booleans", () => {
        const doc = TomlDocument.parse(String.raw`
literal = 'C:\Users\test'
escaped = "line\nbreak"
unicode = "\u0041"
multiline = """
first
second
"""
count = 42
ratio = 3.14
negative = -7
yes = true
no = false
`);
        expect(doc.get(["literal"])).toBe(String.raw`C:\Users\test`);
        expect(doc.get(["escaped"])).toBe("line\nbreak");
        expect(doc.get(["unicode"])).toBe("A");
        expect(doc.get(["multiline"])).toBe("first\nsecond\n");
        expect(doc.get(["count"])).toBe(42);
        expect(doc.get(["ratio"])).toBeCloseTo(3.14, 5);
        expect(doc.get(["negative"])).toBe(-7);
        expect(doc.get(["yes"])).toBe(true);
        expect(doc.get(["no"])).toBe(false);
    });

    test("reads the \\U escape and rejects out-of-range code points", () => {
        const emoji = TomlDocument.parse(String.raw`emoji = "\U0001F600"`);
        expect(emoji.get(["emoji"])).toBe("\u{1F600}");

        const tooBig = TomlDocument.parse(String.raw`bad = "\U00110000"`);
        expect(tooBig.get(["bad"])).toBe("");

        const garbage = TomlDocument.parse(String.raw`bad = "\UZZZZZZZZ"`);
        expect(garbage.get(["bad"])).toBe("");
    });

    test("ignores comments and reads dotted keys", () => {
        const doc = TomlDocument.parse(`
# leading comment
[a.b]           # section comment
c = 1  # trailing comment
d.e = "f"
`);
        expect(doc.get(["a", "b", "c"])).toBe(1);
        expect(doc.get(["a", "b", "d", "e"])).toBe("f");
    });

    test("never throws on malformed input", () => {
        expect(() => TomlDocument.parse("[[[ oops = ")).not.toThrow();
        expect(() => TomlDocument.parse('key = "unterminated')).not.toThrow();
        expect(() => TomlDocument.parse("a = [1, 2")).not.toThrow();
        const doc = TomlDocument.parse("a = [1, 2");
        expect(doc.get(["a"])).toEqual([1, 2]);
    });

    test("returns empty results for absent paths", () => {
        const doc = TomlDocument.parse("");
        expect(doc.get(["anything"])).toBeUndefined();
        expect(doc.childKeys(["anything"])).toEqual([]);
        expect(doc.stringList(["anything"])).toEqual([]);
        expect(doc.tables(["anything"])).toEqual([]);
        expect(doc.hasTable(["anything"])).toBe(false);
    });
});
