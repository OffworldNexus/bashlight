import { describe, expect, test } from "bun:test";

import { BuiltinRegistry } from "../../src/interp/builtins/registry.ts";
import { Interpreter } from "../../src/interp/interpreter.ts";
import type { InterpreterLimits } from "../../src/interp/session.ts";
import { WrapperRegistry } from "../../src/interp/wrappers/registry.ts";
import { Parser } from "../../src/syntax/index.ts";
import { initialState } from "./helpers.ts";

function interpreter(limits: Partial<InterpreterLimits>): Interpreter {
    return new Interpreter({
        parser: new Parser(),
        wrappers: new WrapperRegistry([]),
        builtins: new BuiltinRegistry([]),
        limits,
    });
}

const initial = initialState({ cwd: "/w" });

describe("limits", () => {
    test("deeply nested command substitutions are truncated", () => {
        const deep = `${"$(".repeat(5)}true${")".repeat(5)}`;
        const result = interpreter({ maxNestingDepth: 2 }).interpret(deep, initial);
        expect(result.parse.ok).toBe(true);
        expect(result.truncated).toBe(true);
    });

    test("too many invocations are truncated", () => {
        const result = interpreter({ maxInvocations: 3 }).interpret(
            "true; true; true; true; true; true",
            initial,
        );
        expect(result.truncated).toBe(true);
        expect(result.invocations.length).toBeLessThanOrEqual(3);
    });

    test("never throws on a deeply malformed input", () => {
        expect(() =>
            interpreter({ maxNestingDepth: 2 }).interpret("$(".repeat(500), initial),
        ).not.toThrow();
    });

    test("the limit defaults are applied when none are given", () => {
        const result = interpreter({}).interpret("true", initial);
        expect(result.truncated).toBe(false);
    });
});
