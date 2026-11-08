import { describe, expect, test } from "bun:test";

import type {
    CallArg,
    CommandCall,
    Replacement,
    Rule,
    Verdict,
} from "../../src/rules/rule.ts";
import { commandWithRules, runWithRules } from "./harness.ts";

type Inspect = (call: CommandCall) => Verdict;

function rule(inspect: Inspect): Rule {
    return { id: "custom", scope: "any", inspect };
}

function valueAt(call: CommandCall, index: number): string | undefined {
    return call.argv[index]?.value;
}

function has(call: CommandCall, value: string): boolean {
    return call.argv.some((arg: CallArg) => arg.value === value);
}

function arg(index: number): Replacement {
    return { kind: "arg", index };
}

function text(value: string): Replacement {
    return { kind: "text", value };
}

describe("strategy 1 — word level", () => {
    test("inserts a word before the next anchor", () => {
        const insert = rule((call) =>
            valueAt(call, 0) === "z" && !has(call, "--opt")
                ? {
                      kind: "replace",
                      argv: [arg(0), text("--opt"), arg(1)],
                      reason: "t",
                  }
                : { kind: "keep" },
        );
        expect(commandWithRules([insert], "z a")).toBe("z --opt a");
    });

    test("inserts a word after the last anchor", () => {
        const insert = rule((call) =>
            valueAt(call, 0) === "z" && !has(call, "--opt")
                ? {
                      kind: "replace",
                      argv: [arg(0), arg(1), text("--opt")],
                      reason: "t",
                  }
                : { kind: "keep" },
        );
        expect(commandWithRules([insert], "z a")).toBe("z a --opt");
    });

    test("deletes a whole word together with its separator", () => {
        const drop = rule((call) =>
            valueAt(call, 0) === "z" && call.argv.length === 3
                ? { kind: "replace", argv: [arg(0), arg(2)], reason: "t" }
                : { kind: "keep" },
        );
        expect(commandWithRules([drop], "z a b")).toBe("z b");
    });
});

describe("strategy 2 — binding edit", () => {
    test("folds an identical change into the assignment", () => {
        const prefix = rule((call) =>
            valueAt(call, 0) === "x" && call.argv.length === 2
                ? { kind: "replace", argv: [text("q"), arg(0), arg(1)], reason: "t" }
                : { kind: "keep" },
        );
        expect(commandWithRules([prefix], 'P="x"; $P a.py; $P b.py')).toBe(
            'P="q x"; $P a.py; $P b.py',
        );
    });

    test("keeps a single-quoted assignment single-quoted", () => {
        const prefix = rule((call) =>
            valueAt(call, 0) === "x" && call.argv.length === 2
                ? { kind: "replace", argv: [text("q"), arg(0), arg(1)], reason: "t" }
                : { kind: "keep" },
        );
        expect(commandWithRules([prefix], "P='x'; $P a")).toBe("P='q x'; $P a");
    });
});

describe("strategy 3 — inline", () => {
    test("replaces a variable whose fields are partially deleted", () => {
        const keepLast = rule((call) =>
            valueAt(call, 0) === "x" && call.argv.length === 3
                ? { kind: "replace", argv: [arg(0), arg(2)], reason: "t" }
                : { kind: "keep" },
        );
        expect(commandWithRules([keepLast], 'V="a b"; x $V')).toBe('V="a b"; x b');
    });
});

describe("strategy 4 — regenerate", () => {
    test("rewrites the whole range when arguments are reordered", () => {
        const swap = rule((call) =>
            valueAt(call, 0) === "x" &&
            valueAt(call, 1) === "a" &&
            valueAt(call, 2) === "b"
                ? { kind: "replace", argv: [arg(0), arg(2), arg(1)], reason: "t" }
                : { kind: "keep" },
        );
        expect(commandWithRules([swap], "x a b")).toBe("x b a");
    });
});

describe("env injection", () => {
    const inject = rule((call) =>
        valueAt(call, 0) === "y"
            ? {
                  kind: "replace",
                  argv: [arg(0), text("--flag")],
                  env: { FOO: "bar" },
                  reason: "t",
              }
            : { kind: "keep" },
    );

    test("prefixes a bare command with the assignment", () => {
        expect(commandWithRules([inject], "y")).toBe("FOO=bar y --flag");
    });

    test("uses env after a wrapper", () => {
        expect(commandWithRules([inject], "sudo y")).toBe("sudo env FOO=bar y --flag");
    });
});

describe("grouping and conflicts", () => {
    test("gives up when the same node resolves differently", () => {
        const wrap = rule((call) =>
            valueAt(call, 0) === "x"
                ? { kind: "replace", argv: [text("z"), arg(1)], reason: "t" }
                : { kind: "keep" },
        );
        expect(runWithRules([wrap], 'f() { x "$1"; }; f a; f b').kind).toBe(
            "unchanged",
        );
    });

    test("changes a shared node once when the results agree", () => {
        const drop = rule((call) =>
            valueAt(call, 0) === "x"
                ? { kind: "replace", argv: [text("z")], reason: "t" }
                : { kind: "keep" },
        );
        expect(commandWithRules([drop], 'f() { x "$1"; }; f a; f b')).toBe(
            "f() { z; }; f a; f b",
        );
    });
});
