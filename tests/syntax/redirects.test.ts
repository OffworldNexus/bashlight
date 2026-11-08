import { describe, expect, test } from "bun:test";

import type { HereDoc, Redirect } from "../../src/syntax/ast.ts";
import { parseAssignmentWord } from "../../src/syntax/index.ts";
import {
    commandOf,
    expectParseError,
    expectSpans,
    parseOk,
    simpleCommand,
    simpleCommandOf,
} from "./helpers.ts";

function redirectsOf(text: string): readonly Redirect[] {
    return commandOf(text, "SimpleCommand").redirects;
}

function heredocOf(text: string): HereDoc {
    const target = redirectsOf(text)[0]?.target;
    if (target === undefined || target.kind !== "HereDoc") {
        throw new Error(`expected a heredoc in ${text}`);
    }
    return target;
}

describe("redirection operators", () => {
    test("the common operators", () => {
        const cases: [string, string, string][] = [
            ["echo a > f", ">", "f"],
            ["echo a >> f", ">>", "f"],
            ["echo a < f", "<", "f"],
            ["echo a <> f", "<>", "f"],
            ["echo a >| f", ">|", "f"],
            ["echo a &> f", "&>", "f"],
            ["echo a &>> f", "&>>", "f"],
            ["cat <<< word", "<<<", "word"],
            ["echo a 2> f", ">", "f"],
            ["echo a 2>&1", ">&", "1"],
            ["echo a 0<&3", "<&", "3"],
        ];
        for (const [text, operator, target] of cases) {
            const redirect = redirectsOf(text)[0];
            expect([text, redirect?.operator]).toEqual([text, operator]);
            const word = redirect?.target;
            expect([text, word?.kind === "Word" ? word.value : undefined]).toEqual([
                text,
                target,
            ]);
        }
    });

    test("file descriptor numbers and named descriptors", () => {
        expect(redirectsOf("cmd 2> err")[0]?.fd).toEqual({ kind: "number", fd: 2 });
        expect(redirectsOf("cmd {log}> file")[0]?.fd).toEqual({
            kind: "var",
            name: "log",
        });
        expect(redirectsOf("cmd > file")[0]?.fd).toBeUndefined();
    });

    test("redirections keep their place between words", () => {
        const command = commandOf("cmd a > out b", "SimpleCommand");
        expect(command.elements.map((e) => e.kind)).toEqual([
            "Word",
            "Word",
            "Redirect",
            "Word",
        ]);
        expect(command.words.map((w) => w.value)).toEqual(["cmd", "a", "b"]);
        expect(command.redirects).toHaveLength(1);
    });

    test("multiple redirections", () => {
        expect(redirectsOf("cmd > out 2>&1 < in").map((r) => r.operator)).toEqual([
            ">",
            ">&",
            "<",
        ]);
    });

    test("a comment right after the operator leaves no target", () => {
        expectParseError("echo >#foo");
        expectParseError("echo > #foo");
    });

    test("redirections on compounds", () => {
        expectSpans("if true; then :; fi > out");
        expectSpans("while :; do :; done 2>&1");
        expectSpans("case x in a) : ;; esac < in");
        expectSpans("for i in 1; do :; done > out");
    });
});

describe("assignments", () => {
    test("prefix assignments before the command name", () => {
        const command = commandOf("A=1 B=2 cmd arg", "SimpleCommand");
        expect(command.assignments.map((a) => a.name)).toEqual(["A", "B"]);
        expect(command.words.map((w) => w.value)).toEqual(["cmd", "arg"]);
        expect(command.elements.map((e) => e.kind)).toEqual([
            "Assignment",
            "Assignment",
            "Word",
            "Word",
        ]);
    });

    test("scalar assignment only before the first word", () => {
        const command = commandOf("cmd A=1", "SimpleCommand");
        expect(command.assignments).toHaveLength(0);
        expect(command.words.map((w) => w.value)).toEqual(["cmd", "A=1"]);
    });

    test("assignment value word and spans", () => {
        const assignment = commandOf("A=$x cmd", "SimpleCommand").assignments[0];
        expect(assignment?.append).toBe(false);
        expect(assignment?.nameSpan).toEqual({ start: 0, end: 1 });
        expect(assignment?.valueSpan).toEqual({ start: 2, end: 4 });
    });

    test("array assignment", () => {
        const assignment = commandOf("A=(x y z) cmd", "SimpleCommand").assignments[0];
        expect(assignment?.value.kind).toBe("ArrayValue");
        if (assignment?.value.kind === "ArrayValue") {
            expect(assignment.value.elements.map((e) => e.value)).toEqual([
                "x",
                "y",
                "z",
            ]);
        }
    });

    test("empty array literals", () => {
        expect(commandOf("args=()", "SimpleCommand").assignments).toHaveLength(1);
        expect(commandOf("a=() b", "SimpleCommand").assignments[0]?.name).toBe("a");
        expect(commandOf("arr=( ) cmd", "SimpleCommand").assignments[0]?.name).toBe(
            "arr",
        );
        expect(commandOf("x[1]=()", "SimpleCommand").assignments[0]?.index?.value).toBe(
            "1",
        );
        expect(parseOk("args=()").body.items).toHaveLength(1);
    });

    test("append and array append", () => {
        expect(commandOf("A+=x cmd", "SimpleCommand").assignments[0]?.append).toBe(
            true,
        );
        const array = commandOf("A+=(y) cmd", "SimpleCommand").assignments[0];
        expect(array?.append).toBe(true);
        expect(array?.value.kind).toBe("ArrayValue");
    });

    test("subscripted assignment", () => {
        const assignment = commandOf("A[1]=x cmd", "SimpleCommand").assignments[0];
        expect(assignment?.name).toBe("A");
        expect(assignment?.index?.value).toBe("1");
    });

    test("array assignment after a declaration builtin", () => {
        const command = commandOf("declare -a x=(1 2)", "SimpleCommand");
        expect(command.words.map((w) => w.value)).toEqual(["declare", "-a"]);
        const assignment = command.elements.find((e) => e.kind === "Assignment");
        expect(assignment?.kind === "Assignment" && assignment.name).toBe("x");
    });

    test("an array literal is rejected outside a declaration command", () => {
        expectParseError("echo x=(1 2)");
    });

    test("assignment alone is a command with only assignments", () => {
        const command = simpleCommandOf("A=1");
        expect(command.words).toHaveLength(0);
        expect(command.assignments).toHaveLength(1);
    });

    test("parseAssignmentWord recovers declaration arguments", () => {
        const command = commandOf("export A=1 B+=2 C[0]=x D", "SimpleCommand");
        const [a, b, c, d] = command.words.slice(1);
        expect(parseAssignmentWord(a!)).toEqual({
            name: "A",
            index: undefined,
            append: false,
            value: "1",
        });
        expect(parseAssignmentWord(b!)).toEqual({
            name: "B",
            index: undefined,
            append: true,
            value: "2",
        });
        expect(parseAssignmentWord(c!)).toEqual({
            name: "C",
            index: "0",
            append: false,
            value: "x",
        });
        expect(parseAssignmentWord(d!)).toBeUndefined();
    });

    test("parseAssignmentWord handles quoted values", () => {
        const command = commandOf("export A='a b'", "SimpleCommand");
        expect(parseAssignmentWord(command.words[1]!)?.value).toBe("a b");
    });
});

describe("heredoc shape", () => {
    test("plain heredoc", () => {
        const here = heredocOf("cat <<EOF\nhello $x\nEOF");
        expect(here.delimiter).toBe("EOF");
        expect(here.quoted).toBe(false);
        expect(here.stripTabs).toBe(false);
        expect(here.terminated).toBe(true);
        expect(here.bodySpan).toEqual({ start: 10, end: 19 });
        expectSpans("cat <<EOF\nhello $x\nEOF");
    });

    test("quoted delimiter disables expansion", () => {
        const here = heredocOf("cat <<'EOF'\n$x literal\nEOF");
        expect(here.quoted).toBe(true);
        expect(here.body.parts.map((p) => p.kind)).toEqual(["Literal"]);
    });

    test("<<- strips leading tabs", () => {
        const here = heredocOf("cat <<-EOF\n\tindented\n\tEOF");
        expect(here.stripTabs).toBe(true);
        expect(here.body.value).toBe("indented\n");
    });

    test("two heredocs on one line", () => {
        const redirects = redirectsOf("cat <<A <<B\none\nA\ntwo\nB");
        const first = redirects[0]?.target as HereDoc;
        const second = redirects[1]?.target as HereDoc;
        expect(first.body.value).toBe("one\n");
        expect(second.body.value).toBe("two\n");
        expectSpans("cat <<A <<B\none\nA\ntwo\nB");
    });

    test("heredoc with expansions in its body", () => {
        const here = heredocOf("cat <<EOF\nvalue=$x $(echo y)\nEOF");
        const kinds = here.body.parts.map((p) => p.kind);
        expect(kinds).toContain("ParameterExpansion");
        expect(kinds).toContain("CommandSubstitution");
    });

    test("heredoc inside a command substitution", () => {
        expectSpans("x=$(cat <<EOF\nbody\nEOF\n)");
    });

    test("EOF-terminated heredoc takes the rest of the input", () => {
        const text = "python3 - <<'PY' 2>&1 || python3 - <<'PY'\nprint(1)\nPY";
        const script = parseOk(text);
        const first = simpleCommand(script, 0).redirects[0]?.target as HereDoc;
        const second = simpleCommand(script, 1).redirects[0]?.target as HereDoc;
        expect(first.terminated).toBe(true);
        expect(first.body.value).toBe("print(1)\n");
        expect(second.terminated).toBe(false);
        expect(second.body.value).toBe("");
    });
});
