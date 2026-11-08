import { describe, expect, test } from "bun:test";

import type { CallArg } from "../../src/rules/rule.ts";
import {
    arg,
    argsFrom,
    block,
    keep,
    replace,
    ReplacementResolver,
    text,
} from "../../src/rules/verdict.ts";

function literal(value: string): CallArg {
    return { value, origin: "literal" };
}

describe("verdict builders", () => {
    test("keep and block", () => {
        expect(keep()).toEqual({ kind: "keep" });
        expect(block("nope")).toEqual({ kind: "block", message: "nope" });
    });

    test("replace omits env when not given", () => {
        expect(replace([], "r")).toEqual({ kind: "replace", argv: [], reason: "r" });
        expect(Object.hasOwn(replace([], "r"), "env")).toBe(false);
        expect(replace([arg(0)], "r", { A: "1" })).toEqual({
            kind: "replace",
            argv: [{ kind: "arg", index: 0 }],
            reason: "r",
            env: { A: "1" },
        });
    });

    test("arg, text and argsFrom", () => {
        expect(arg(2)).toEqual({ kind: "arg", index: 2 });
        expect(text("a", "b")).toEqual([
            { kind: "text", value: "a" },
            { kind: "text", value: "b" },
        ]);
        const argv = ["a", "b", "c", "d"].map(literal);
        expect(argsFrom(argv, 2)).toEqual([
            { kind: "arg", index: 2 },
            { kind: "arg", index: 3 },
        ]);
        expect(argsFrom(argv, 9)).toEqual([]);
    });
});

describe("ReplacementResolver", () => {
    test("resolves arg references, text and out-of-range indices", () => {
        const original = [
            { value: "a", origin: "variable" as const },
            { value: "b", origin: "literal" as const },
        ];
        const resolver = new ReplacementResolver(original);
        expect(resolver.resolve([arg(0), ...text("x"), arg(1), arg(9)])).toEqual([
            { value: "a", origin: "variable" },
            { value: "x", origin: "literal" },
            { value: "b", origin: "literal" },
            { value: undefined, origin: "unknown" },
        ]);
    });
});
