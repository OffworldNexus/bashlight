import { describe, expect, test } from "bun:test";

import type { ParameterExpansionPart, WordPart } from "../../src/syntax/ast.ts";
import { expectSpans, simpleCommand, simpleCommandOf } from "./helpers.ts";

function word(text: string, index = 1): readonly WordPart[] {
    const command = simpleCommandOf(text);
    const target = command.words[index];
    if (target === undefined) {
        throw new Error(`no word #${index} in ${JSON.stringify(text)}`);
    }
    expectSpans(text);
    return target.parts;
}

function only<T extends WordPart["kind"]>(
    parts: readonly WordPart[],
    kind: T,
): Extract<WordPart, { kind: T }> {
    expect(parts).toHaveLength(1);
    const part = parts[0];
    if (part === undefined || part.kind !== kind) {
        throw new Error(
            `expected a single ${kind}, got ${parts.map((p) => p.kind).join(", ")}`,
        );
    }
    return part as Extract<WordPart, { kind: T }>;
}

describe("literals and quoting", () => {
    test("plain literal", () => {
        const part = only(word("echo foo"), "Literal");
        expect(part.value).toBe("foo");
        expect(part.hasGlob).toBe(false);
    });

    test("glob characters are flagged on unquoted literals", () => {
        const command = simpleCommandOf("echo *.ts ?file [a-z]");
        for (const index of [1, 2, 3]) {
            const part = command.words[index]?.parts[0];
            expect([index, part?.kind === "Literal" && part.hasGlob]).toEqual([
                index,
                true,
            ]);
        }
    });

    test("glob characters are not flagged when escaped or quoted", () => {
        const escaped = only(word("echo a\\*b"), "Literal");
        expect(escaped.value).toBe("a*b");
        expect(escaped.hasGlob).toBe(false);
        const quoted = only(word("echo 'a*b'"), "SingleQuoted");
        expect(quoted.value).toBe("a*b");
    });

    test("single quotes keep everything literal", () => {
        const part = only(word("echo 'a $b `c` \\'"), "SingleQuoted");
        expect(part.value).toBe("a $b `c` \\");
    });

    test("double quotes expand but keep spaces", () => {
        const part = only(word('echo "a $b c"'), "DoubleQuoted");
        expect(part.parts.map((p) => p.kind)).toEqual([
            "Literal",
            "ParameterExpansion",
            "Literal",
        ]);
        const literal = part.parts[0];
        expect(literal?.kind === "Literal" && literal.value).toBe("a ");
    });

    test('backslash escapes inside double quotes only for $ ` " \\', () => {
        const part = only(word('echo "a\\"b\\\\c\\nd"'), "DoubleQuoted");
        const literal = part.parts[0];
        expect(literal?.kind === "Literal" && literal.value).toBe('a"b\\c\\nd');
    });

    test("ansi-c quoting decodes escapes", () => {
        const part = only(word("echo $'a\\tb\\n\\x41\\u0042\\101'"), "AnsiCQuoted");
        expect(part.value).toBe("a\tb\nABA");
    });

    test("ansi-c control, hex, octal and invalid escapes", () => {
        expect(only(word("echo $'\\cA'"), "AnsiCQuoted").value).toBe("\x01");
        expect(only(word("echo $'\\c?'"), "AnsiCQuoted").value).toBe("\x7f");
        // `\x` / `\xg` have no hex digit: the backslash stays literal.
        expect(only(word("echo $'\\x'"), "AnsiCQuoted").value).toBe("\\x");
        expect(only(word("echo $'\\xg'"), "AnsiCQuoted").value).toBe("\\xg");
        // Octal is a byte, masked to 0xFF.
        expect(only(word("echo $'\\777'"), "AnsiCQuoted").value).toBe("\u00ff");
        // Out-of-range \U is kept literal rather than throwing.
        expect(only(word("echo $'\\U00110000'"), "AnsiCQuoted").value).toBe(
            "\\U00110000",
        );
    });

    test("locale quoting behaves like double quotes", () => {
        const part = only(word('echo $"hi $x"'), "LocaleQuoted");
        expect(part.parts.map((p) => p.kind)).toEqual([
            "Literal",
            "ParameterExpansion",
        ]);
    });

    test("backslash removes the next character", () => {
        const part = only(word("echo a\\ b"), "Literal");
        expect(part.value).toBe("a b");
    });

    test("carriage return is an ordinary word character", () => {
        const command = simpleCommandOf("echo hi\r");
        expect(command.words.map((w) => w.value)).toEqual(["echo", "hi\r"]);
    });

    test("line continuation is removed from the value but kept in the span", () => {
        const text = "echo a\\\nb";
        const parts = word(text);
        const literal = parts[0];
        expect(literal?.kind === "Literal" && literal.value).toBe("ab");
        const command = simpleCommandOf(text);
        const target = command.words[1];
        expect(target?.span).toEqual({ start: 5, end: 9 });
    });
});

describe("tildes", () => {
    test("bare and user tildes", () => {
        const bare = only(word("echo ~"), "Tilde");
        expect(bare.value).toBe("~");
        expect(bare.user).toBeUndefined();
        const user = only(word("echo ~root"), "Tilde");
        expect(user.value).toBe("~root");
    });

    test("tilde followed by a path", () => {
        const parts = word("echo ~/bin");
        expect(parts.map((p) => p.kind)).toEqual(["Tilde", "Literal"]);
    });

    test("tilde is not special mid-word", () => {
        const parts = word("echo a~b");
        expect(parts.map((p) => p.kind)).toEqual(["Literal"]);
    });

    test("tilde after : or = in an assignment value", () => {
        const command = simpleCommandOf("PATH=~/bin:~/x cmd");
        const assignment = command.assignments[0];
        const value = assignment?.value;
        const parts = value?.kind === "Word" ? value.parts : [];
        expect(parts.map((p) => p.kind)).toEqual([
            "Tilde",
            "Literal",
            "Tilde",
            "Literal",
        ]);
    });
});

describe("brace expansion", () => {
    test("comma list", () => {
        const parts = word("echo {a,b}");
        const brace = only(parts, "BraceExpansion");
        expect(brace.alternatives.map((a) => a.value)).toEqual(["a", "b"]);
        expect(brace.sequence).toBe(false);
    });

    test("sequence", () => {
        const brace = only(word("echo {1..10..2}"), "BraceExpansion");
        expect(brace.alternatives.map((a) => a.value)).toEqual(["1", "10", "2"]);
        expect(brace.sequence).toBe(true);
    });

    test("prefix and suffix stay literal parts", () => {
        const parts = word("echo x{a,b}y");
        expect(parts.map((p) => p.kind)).toEqual([
            "Literal",
            "BraceExpansion",
            "Literal",
        ]);
    });

    test("invalid brace forms stay literal", () => {
        expect(word("echo {a}")[0]?.kind).toBe("Literal");
        expect(word("echo {a, b}")[0]?.kind).toBe("Literal");
    });

    test("nested braces", () => {
        const brace = only(word("echo {a,{b,c}}"), "BraceExpansion");
        expect(brace.alternatives[0]?.value).toBe("a");
        const nested = brace.alternatives[1];
        expect(nested?.parts[0]?.kind).toBe("BraceExpansion");
    });
});

describe("parameter expansion", () => {
    test("simple and special parameters", () => {
        const expected = ["x", "x", "1", "@", "*", "#", "?", "$", "!", "-", "0"];
        const text = "echo $x ${x} $1 $@ $* $# $? $$ $! $- $0";
        const command = simpleCommandOf(text);
        const words = command.words.slice(1);
        expect(words.map((w) => (w.parts[0] as ParameterExpansionPart).name)).toEqual(
            expected,
        );
        expect(
            words[0]?.parts[0]?.kind === "ParameterExpansion" &&
                words[0].parts[0].simple,
        ).toBe(true);
        expect(
            words[1]?.parts[0]?.kind === "ParameterExpansion" &&
                words[1].parts[0].simple,
        ).toBe(false);
    });

    test("operators with arguments", () => {
        const cases: [string, string, string | undefined][] = [
            ["${x:-a b}", ":-", "a b"],
            ["${x:=y}", ":=", "y"],
            ["${x:?msg}", ":?", "msg"],
            ["${x:+alt}", ":+", "alt"],
            ["${x#p}", "#", "p"],
            ["${x##p}", "##", "p"],
            ["${x%s}", "%", "s"],
            ["${x%%s}", "%%", "s"],
            ["${x/a/b}", "/", "a/b"],
            ["${x//a/b}", "//", "a/b"],
            ["${x/#a/b}", "/#", "a/b"],
            ["${x/%a/b}", "/%", "a/b"],
        ];
        for (const [text, operator, argument] of cases) {
            const part = only(word(`echo ${text}`), "ParameterExpansion");
            expect([text, part.operator]).toEqual([text, operator]);
            expect([text, part.argument?.value]).toEqual([text, argument]);
        }
    });

    test("substring and transform operators", () => {
        const substring = only(word("echo ${x:1:2}"), "ParameterExpansion");
        expect(substring.operator).toBe(":");
        expect(substring.argument?.value).toBe("1:2");
        const upper = only(word("echo ${x^^}"), "ParameterExpansion");
        expect(upper.operator).toBe("^^");
        const transform = only(word("echo ${x@Q}"), "ParameterExpansion");
        expect(transform.operator).toBe("@Q");
        expect(transform.argument).toBeUndefined();
    });

    test("length and indirection", () => {
        const length = only(word("echo ${#x}"), "ParameterExpansion");
        const isLength = length.length;
        expect(isLength).toBe(true);
        expect(length.name).toBe("x");
        const indirect = only(word("echo ${!ref}"), "ParameterExpansion");
        expect(indirect.indirect).toBe(true);
        expect(indirect.name).toBe("ref");
    });

    test("subscripts", () => {
        const part = only(word("echo ${arr[@]}"), "ParameterExpansion");
        expect(part.name).toBe("arr");
        expect(part.index?.value).toBe("@");
        const length = only(word("echo ${#arr[@]}"), "ParameterExpansion");
        const isLength = length.length;
        expect(isLength).toBe(true);
        expect(length.name).toBe("arr");
        expect(length.index?.value).toBe("@");
    });

    test("the length-of-$# corner keeps its parameter", () => {
        const part = only(word("echo ${##}"), "ParameterExpansion");
        const isLength = part.length;
        expect(isLength).toBe(true);
        expect(part.name).toBe("#");
    });

    test("an empty operator argument", () => {
        const part = only(word("echo ${x:-}"), "ParameterExpansion");
        expect(part.operator).toBe(":-");
        expect(part.argument).toBeUndefined();
    });
});

describe("arithmetic, command and process substitution", () => {
    test("arithmetic expansions keep their raw text", () => {
        const dollar = only(word("echo $((1 << 2 | 3))"), "ArithmeticExpansion");
        expect(dollar.expression).toBe("1 << 2 | 3");
        const bracket = only(word("echo $[1 + 2]"), "ArithmeticExpansion");
        expect(bracket.expression).toBe("1 + 2");
    });

    test("$[ … ] with a nested subscript ]", () => {
        const bracket = only(word("echo $[a[1]]"), "ArithmeticExpansion");
        expect(bracket.expression).toBe("a[1]");
    });

    test("command substitution parses its script", () => {
        const parts = word("echo $(echo hi)");
        const part = only(parts, "CommandSubstitution");
        expect(part.style).toBe("dollar");
        const inner = simpleCommand(part.script);
        expect(inner.words.map((w) => w.value)).toEqual(["echo", "hi"]);
    });

    test("backtick substitution parses its script", () => {
        const part = only(word("echo `echo hi`"), "CommandSubstitution");
        expect(part.style).toBe("backtick");
        expect(simpleCommand(part.script).words.map((w) => w.value)).toEqual([
            "echo",
            "hi",
        ]);
    });

    test("escaped backticks inside backticks stay literal (known limitation)", () => {
        const part = only(word("echo `echo \\`date\\``"), "CommandSubstitution");
        expect(part.style).toBe("backtick");
        expect(simpleCommand(part.script).words.map((w) => w.value)).toEqual([
            "echo",
            "`date`",
        ]);
    });

    test("nested command substitution and case inside $()", () => {
        const text = "echo $(echo nested $(echo deep)) $(case x in a) echo A ;; esac)";
        const command = simpleCommandOf(text);
        const first = command.words[1]?.parts[0];
        expect(first?.kind).toBe("CommandSubstitution");
        if (first?.kind === "CommandSubstitution") {
            const inner = simpleCommand(first.script, 0);
            expect(inner.words[0]?.value).toBe("echo");
            expect(inner.words[1]?.value).toBe("nested");
        }
        const second = command.words[2]?.parts[0];
        expect(second?.kind).toBe("CommandSubstitution");
    });

    test("process substitution", () => {
        const command = simpleCommandOf("echo <(cat x) >(tee y)");
        const input = command.words[1]?.parts[0];
        expect(input?.kind).toBe("ProcessSubstitution");
        expect(input?.kind === "ProcessSubstitution" && input.direction).toBe("<");
        const output = command.words[2]?.parts[0];
        expect(output?.kind === "ProcessSubstitution" && output.direction).toBe(">");
    });
});

describe("word values", () => {
    test("value joins known parts and is undefined with expansions", () => {
        expect(simpleCommandOf("echo x'y'z").words[1]?.value).toBe("xyz");
        expect(simpleCommandOf("echo a$x").words[1]?.value).toBeUndefined();
    });
});

describe("reserved words as arguments", () => {
    test("if/then/else after a command name are plain words", () => {
        const command = simpleCommandOf("echo if then else fi do done");
        expect(command.words.map((w) => w.value)).toEqual([
            "echo",
            "if",
            "then",
            "else",
            "fi",
            "do",
            "done",
        ]);
    });

    test("a brace word is not a group", () => {
        const parts = word("echo {a,b}");
        expect(parts[0]?.kind).toBe("BraceExpansion");
    });
});
