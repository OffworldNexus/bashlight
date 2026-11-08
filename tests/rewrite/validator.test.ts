import { describe, expect, test } from "bun:test";

import { createInterpreter, type Interpretation } from "../../src/interp/index.ts";
import { buildExpected } from "../../src/rewrite/expected.ts";
import { type ExpectedInvocation, validate } from "../../src/rewrite/validator.ts";

const INITIAL = { cwd: "/", variables: {}, complete: true };

function interpret(command: string): Interpretation {
    return createInterpreter().interpret(command, INITIAL);
}

/** Builds the expected shape from a reference interpretation of `command`. */
function expected(command: string): ExpectedInvocation[] {
    const reference = interpret(command);
    return buildExpected({
        interpretation: reference,
        plan: { rewritten: [], overrides: new Map(), bindingValues: new Map() },
        ownerOf: new Map(),
    });
}

describe("validate", () => {
    test("accepts an unchanged command", () => {
        expect(validate(interpret("x a"), expected("x a")).ok).toBe(true);
    });

    test("rejects a changed argv", () => {
        expect(validate(interpret("x b"), expected("x a")).ok).toBe(false);
    });

    test("rejects a different invocation count", () => {
        expect(validate(interpret("x a; y"), expected("x a")).ok).toBe(false);
    });

    test("rejects a changed cwd", () => {
        const wanted = expected("x a");
        const moved: ExpectedInvocation[] = [
            { ...(wanted[0] as ExpectedInvocation), cwd: "/other" },
        ];
        expect(validate(interpret("x a"), moved).ok).toBe(false);
    });

    test("rejects a changed redirect target", () => {
        expect(validate(interpret("x a > b"), expected("x a > c")).ok).toBe(false);
    });

    test("rejects a changed heredoc body", () => {
        const before = "cat <<EOF\none\nEOF";
        const after = "cat <<EOF\ntwo\nEOF";
        expect(validate(interpret(after), expected(before)).ok).toBe(false);
    });

    test("rejects a changed prefix assignment", () => {
        expect(validate(interpret("A=2 x"), expected("A=1 x")).ok).toBe(false);
    });

    test("checks that injected variables landed", () => {
        const wanted: ExpectedInvocation[] = [
            {
                kind: "external",
                argv: ["y"],
                cwd: "/",
                host: { kind: "local" },
                injected: { FOO: "bar" },
                env: {},
                redirects: [],
            },
        ];
        expect(validate(interpret("FOO=bar y"), wanted).ok).toBe(true);
        expect(validate(interpret("y"), wanted).ok).toBe(false);
    });
});
