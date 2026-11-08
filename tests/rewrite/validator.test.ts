import { describe, expect, test } from "bun:test";

import { createInterpreter, type Interpretation } from "../../src/interp/index.ts";
import { type ExpectedInvocation, validate } from "../../src/rewrite/validator.ts";

const INITIAL = { cwd: "/", variables: {}, complete: true };

function interpret(command: string): Interpretation {
    return createInterpreter().interpret(command, INITIAL);
}

function expected(command: string): ExpectedInvocation[] {
    return interpret(command).invocations.map((invocation) => ({
        kind: invocation.kind,
        argv: invocation.argv.map((arg) => arg.value),
        cwd: invocation.context.cwd,
        host: invocation.context.host,
        env: {},
    }));
}

describe("validate", () => {
    test("accepts an unchanged command", () => {
        expect(validate(interpret("x a"), expected("x a")).ok).toBe(true);
    });

    test("rejects a changed argv", () => {
        const result = validate(interpret("x b"), expected("x a"));
        expect(result.ok).toBe(false);
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

    test("checks that env injections landed", () => {
        const wanted: ExpectedInvocation[] = [
            {
                kind: "external",
                argv: ["y"],
                cwd: "/",
                host: { kind: "local" },
                env: { FOO: "bar" },
            },
        ];
        expect(validate(interpret("FOO=bar y"), wanted).ok).toBe(true);
        expect(validate(interpret("y"), wanted).ok).toBe(false);
    });
});
