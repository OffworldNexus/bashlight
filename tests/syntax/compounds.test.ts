import { describe, expect, test } from "bun:test";

import {
    commandOf,
    expectParseError,
    expectSpans,
    simpleCommandOf,
} from "./helpers.ts";

describe("subshells and brace groups", () => {
    test("subshell with a trailing redirect", () => {
        const subshell = commandOf("( cd /tmp; ls ) > out", "Subshell");
        expect(subshell.body.items).toHaveLength(2);
        expect(subshell.redirects.map((r) => r.operator)).toEqual([">"]);
    });

    test("brace group", () => {
        const group = commandOf("{ echo a; echo b; } > log 2>&1", "BraceGroup");
        expect(group.body.items).toHaveLength(2);
        expect(group.redirects.map((r) => r.operator)).toEqual([">", ">&"]);
    });

    test("an empty brace group is rejected", () => {
        expectParseError("{ }");
    });

    test("{a,b} at the command position is brace expansion, not a group", () => {
        const command = simpleCommandOf("{a,b} echo");
        expect(command.words[0]?.parts[0]?.kind).toBe("BraceExpansion");
    });
});

describe("conditionals", () => {
    test("if / elif / else", () => {
        const cond = commandOf("if a; then b; elif c; then d; else e; fi", "If");
        expect(cond.clauses).toHaveLength(2);
        expect(cond.elseBody?.items).toHaveLength(1);
    });

    test("if without else", () => {
        const cond = commandOf("if true\nthen\n  echo yes\nfi", "If");
        expect(cond.clauses).toHaveLength(1);
        expect(cond.elseBody).toBeUndefined();
    });
});

describe("loops", () => {
    test("for list form", () => {
        const forLoop = commandOf("for i in a b c; do echo $i; done", "For");
        expect(forLoop.header.name).toBe("i");
        expect(forLoop.header.items.map((w) => w.value)).toEqual(["a", "b", "c"]);
        expect(forLoop.body.items).toHaveLength(1);
    });

    test("for without in", () => {
        const forLoop = commandOf("for i; do echo $i; done", "For");
        expect(forLoop.header.name).toBe("i");
        expect(forLoop.header.items).toHaveLength(0);
    });

    test("for arithmetic form", () => {
        const forLoop = commandOf("for ((i = 0; i < 3; i++)); do echo $i; done", "For");
        expect(forLoop.header.arithmetic?.init).toBe("i = 0");
        expect(forLoop.header.arithmetic?.condition).toBe("i < 3");
        expect(forLoop.header.arithmetic?.update).toBe("i++");
    });

    test("while and until", () => {
        const whileLoop = commandOf("while read x; do echo $x; done < f", "While");
        expect(whileLoop.redirects).toHaveLength(1);
        const untilLoop = commandOf("until [ -f x ]; do :; done", "Until");
        expect(untilLoop.body.items).toHaveLength(1);
    });

    test("select", () => {
        const select = commandOf("select x in a b; do break; done", "Select");
        expect(select.header.name).toBe("x");
        expect(select.header.items.map((w) => w.value)).toEqual(["a", "b"]);
    });

    test("a loop without a condition is rejected", () => {
        expectParseError("while; do :; done");
    });
});

describe("case", () => {
    test("patterns and terminators", () => {
        const command = commandOf(
            "case $x in a|b) echo ab ;; c) echo c ;& *) echo other ;;& esac",
            "Case",
        );
        expect(command.word.parts[0]?.kind).toBe("ParameterExpansion");
        expect(command.items).toHaveLength(3);
        expect(command.items[0]?.patterns.map((p) => p.value)).toEqual(["a", "b"]);
        expect(command.items.map((item) => item.terminator)).toEqual([
            ";;",
            ";&",
            ";;&",
        ]);
    });

    test("empty item body and leading parenthesis", () => {
        const command = commandOf("case x in (a) ;; esac", "Case");
        expect(command.items[0]?.patterns[0]?.value).toBe("a");
        expect(command.items[0]?.body.items).toHaveLength(0);
    });

    test("an item without a terminator before esac", () => {
        const command = commandOf("case x in a) echo a\nesac", "Case");
        expect(command.items).toHaveLength(1);
        expect(command.items[0]?.terminator).toBeUndefined();
    });
});

describe("functions", () => {
    test("posix function definition", () => {
        const fn = commandOf("f() { echo hi; }", "FunctionDefinition");
        expect(fn.name).toBe("f");
        expect(fn.functionKeyword).toBe(false);
        expect(fn.body.kind).toBe("BraceGroup");
    });

    test("function keyword form", () => {
        const fn = commandOf("function g { echo hi; }", "FunctionDefinition");
        expect(fn.name).toBe("g");
        expect(fn.functionKeyword).toBe(true);
    });

    test("names may contain dashes", () => {
        const fn = commandOf("my-func() { :; }", "FunctionDefinition");
        expect(fn.name).toBe("my-func");
    });

    test("a simple command body is rejected", () => {
        expectParseError("f() echo hi");
    });
});

describe("arithmetic and test commands", () => {
    test("(( )) arithmetic command", () => {
        const command = commandOf("(( x = 1 << 2 ))", "ArithmeticCommand");
        expect(command.expression).toBe(" x = 1 << 2 ");
    });

    test("quotes inside (( ))", () => {
        const command = commandOf('(( x = "a)" ))', "ArithmeticCommand");
        expect(command.expression).toBe(' x = "a)" ');
    });

    test("[[ ]] keeps words and operators", () => {
        const command = commandOf("[[ -f x && $a < $b ]]", "TestCommand");
        expect(command.words.map((w) => w.value)).toEqual([
            "-f",
            "x",
            undefined,
            undefined,
        ]);
        const operators = command.elements
            .filter((e) => e.kind === "TestOperator")
            .map((e) => (e.kind === "TestOperator" ? e.operator : ""));
        expect(operators).toEqual(["&&", "<"]);
    });

    test("[[ ]] with =~ and parentheses", () => {
        const command = commandOf("[[ ( $x =~ ^a|b$ ) ]]", "TestCommand");
        const operators = command.elements
            .filter((e) => e.kind === "TestOperator")
            .map((e) => (e.kind === "TestOperator" ? e.operator : ""));
        expect(operators).toEqual(["(", "=~", ")"]);
    });

    test("[[ ]] redirect after the command", () => {
        const command = commandOf("[[ -n $x ]] 2>/dev/null", "TestCommand");
        expect(command.redirects).toHaveLength(1);
    });

    test("# starts a comment inside [[ ]]", () => {
        const command = commandOf("[[ -n x # comment\n ]]", "TestCommand");
        expect(command.words.map((w) => w.value)).toEqual(["-n", "x"]);
    });
});

describe("coproc", () => {
    test("coproc with a name and a group", () => {
        const command = commandOf("coproc worker { echo hi; }", "Coproc");
        expect(command.name).toBe("worker");
        expect(command.nameSpan).toEqual({ start: 7, end: 13 });
        expect(command.body?.kind).toBe("BraceGroup");
    });

    test("coproc with a simple command has no name", () => {
        const command = commandOf("coproc ls -l", "Coproc");
        expect(command.name).toBeUndefined();
        expect(command.body?.kind).toBe("SimpleCommand");
    });
});

describe("span round-trip on compounds", () => {
    test("a dense compound snippet", () => {
        expectSpans(
            "if [ -f x ]; then for i in 1 2; do echo $i; done; else while :; do break; done; fi",
        );
    });
    test("case inside a command substitution", () => {
        expectSpans("x=$(case y in a) echo A ;; *) echo B ;; esac)");
    });
});
