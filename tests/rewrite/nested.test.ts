import { describe, expect, test } from "bun:test";

import { createInterpreter } from "../../src/interp/index.ts";
import type { CommandCall, Rule, Verdict } from "../../src/rules/rule.ts";
import { commandWithRules } from "./harness.ts";

function replaceCommand(name: string, argv: (call: CommandCall) => Verdict): Rule {
    return {
        id: "custom",
        scope: "any",
        inspect: (call: CommandCall) =>
            call.argv[0]?.value === name ? argv(call) : { kind: "keep" },
    };
}

const X_TO_Z = replaceCommand("x", () => ({
    kind: "replace",
    argv: [{ kind: "text", value: "z" }],
    reason: "test",
}));

describe("nested documents", () => {
    test("maps single-quoted inner edits 1:1", () => {
        expect(commandWithRules([X_TO_Z], "bash -c 'x a'")).toBe("bash -c 'z'");
    });

    test("maps double-quoted inner edits 1:1", () => {
        expect(commandWithRules([X_TO_Z], 'bash -c "x a"')).toBe('bash -c "z"');
    });

    test("re-escapes single quotes for the outer quoting", () => {
        const rule = replaceCommand("x", () => ({
            kind: "replace",
            argv: [{ kind: "text", value: "a'b" }],
            reason: "test",
        }));
        const command = commandWithRules([rule], "bash -c 'x'");
        expect(command).toBeDefined();
        const inner = createInterpreter().interpret(command as string, {
            cwd: "/",
            variables: {},
            complete: true,
        });
        const nested = inner.invocations[1];
        expect(nested?.argv[0]?.value).toBe("a'b");
    });

    test("rewrites a nested command inside a compound command", () => {
        expect(commandWithRules([X_TO_Z], "bash -c 'true && x a'")).toBe(
            "bash -c 'true && z'",
        );
    });
});
