import { describe, expect, test } from "bun:test";

import type { CallArg, CommandCall, Rule, Verdict } from "../../src/rules/rule.ts";
import { arg, text } from "../../src/rules/verdict.ts";
import { commandWithRules, runWithRules } from "./harness.ts";

type Inspect = (call: CommandCall) => Verdict;

function rule(inspect: Inspect): Rule {
    return { id: "custom", scope: "any", inspect };
}

function valueAt(call: CommandCall, index: number): string | undefined {
    return call.argv[index]?.value;
}

function has(call: CommandCall, value: string): boolean {
    return call.argv.some((candidate: CallArg) => candidate.value === value);
}

describe("strategy 1 — word level", () => {
    test("inserts a word before the next anchor", () => {
        const insert = rule((call) =>
            valueAt(call, 0) === "z" && !has(call, "--opt")
                ? {
                      kind: "replace",
                      argv: [arg(0), ...text("--opt"), arg(1)],
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
                      argv: [arg(0), arg(1), ...text("--opt")],
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
    function prefixRule(): Rule {
        return rule((call) =>
            valueAt(call, 0) === "x" && call.argv.length === 2
                ? {
                      kind: "replace",
                      argv: [...text("q"), arg(0), arg(1)],
                      reason: "t",
                  }
                : { kind: "keep" },
        );
    }

    test("folds an identical change into the assignment", () => {
        expect(commandWithRules([prefixRule()], 'P="x"; $P a.py; $P b.py')).toBe(
            'P="q x"; $P a.py; $P b.py',
        );
    });

    test("keeps a single-quoted assignment single-quoted", () => {
        expect(commandWithRules([prefixRule()], "P='x'; $P a")).toBe("P='q x'; $P a");
    });

    test("refuses to fold when an item would split into several words", () => {
        const prefix = rule((call) =>
            valueAt(call, 0) === "x" && call.argv.length === 2
                ? {
                      kind: "replace",
                      argv: [...text("poetry run"), arg(0), arg(1)],
                      reason: "t",
                  }
                : { kind: "keep" },
        );
        const command = commandWithRules([prefix], 'P="x"; $P a.py');
        expect(command).not.toContain('P="poetry');
        expect(command).toContain("'poetry run'");
    });

    test("does not fold an append assignment", () => {
        const prefix = rule((call) =>
            valueAt(call, 0) === "xy" && call.argv.length === 2
                ? {
                      kind: "replace",
                      argv: [...text("q"), arg(0), arg(1)],
                      reason: "t",
                  }
                : { kind: "keep" },
        );
        const command = commandWithRules([prefix], 'P="x"; P+="y"; $P a.py');
        expect(command).not.toContain('P+="q xy"');
        expect(command).toContain("q $P a.py");
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
                  argv: [arg(0), ...text("--flag")],
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
                ? { kind: "replace", argv: [...text("z"), arg(1)], reason: "t" }
                : { kind: "keep" },
        );
        expect(runWithRules([wrap], 'f() { x "$1"; }; f a; f b').kind).toBe(
            "unchanged",
        );
    });

    test("changes a shared node once when the results agree", () => {
        const drop = rule((call) =>
            valueAt(call, 0) === "x"
                ? { kind: "replace", argv: [...text("z")], reason: "t" }
                : { kind: "keep" },
        );
        expect(commandWithRules([drop], 'f() { x "$1"; }; f a; f b')).toBe(
            "f() { z; }; f a; f b",
        );
    });
});
