import { describe, expect, test } from "bun:test";

import { type FlagSpec, parseArgv } from "../../src/cli/argv.ts";

const SPEC: readonly FlagSpec[] = [
    { name: "log", value: true },
    { name: "all" },
    { name: "since", value: true },
    { name: "no-color" },
];

function expectOk(args: readonly string[], specs = SPEC, options = {}) {
    const result = parseArgv(args, specs, options);
    if (!result.ok) {
        throw new Error(`expected a parse, got error: ${result.error}`);
    }
    return result.flags;
}

describe("parseArgv", () => {
    test("parses boolean flags and positionals", () => {
        const flags = expectOk(["watch", "--all"]);
        expect(flags.bool("all")).toBe(true);
        expect(flags.bool("since")).toBe(false);
        expect(flags.positionals).toEqual(["watch"]);
    });

    test("accepts --x=v and --x v for value flags", () => {
        expect(expectOk(["--log=/a.jsonl"]).value("log")).toBe("/a.jsonl");
        expect(expectOk(["--log", "/a.jsonl"]).value("log")).toBe("/a.jsonl");
    });

    test("keeps the last value when a flag repeats", () => {
        expect(expectOk(["--log", "a", "--log", "b"]).value("log")).toBe("b");
    });

    test("recognizes --help and -h", () => {
        expect(expectOk(["--help"]).bool("help")).toBe(true);
        expect(expectOk(["-h"]).bool("help")).toBe(true);
    });

    test("stops option parsing at --", () => {
        const flags = expectOk(["--", "--all", "-x"]);
        expect(flags.bool("all")).toBe(false);
        expect(flags.positionals).toEqual(["--all", "-x"]);
    });

    test("rejects unknown options with an error", () => {
        const result = parseArgv(["--nope"], SPEC);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toContain("--nope");
        }
    });

    test("rejects a missing value and a value on a boolean", () => {
        const missing = parseArgv(["--log"], SPEC);
        expect(missing.ok).toBe(false);
        const extra = parseArgv(["--all=1"], SPEC);
        expect(extra.ok).toBe(false);
    });

    test("treats unknown tokens as positionals in explain mode", () => {
        const explainSpec: readonly FlagSpec[] = [
            ...SPEC,
            { name: "cwd", value: true },
        ];
        const flags = expectOk(
            ["pip", "install", "-r", "req.txt", "--cwd", "/w"],
            explainSpec,
            { unknownAsPositional: true },
        );
        expect(flags.positionals).toEqual(["pip", "install", "-r", "req.txt"]);
        expect(flags.value("cwd")).toBe("/w");
    });
});
