/* eslint-disable sonarjs/function-return-type */
import { describe, expect, test } from "bun:test";

import { createInterpreter } from "../../src/interp/index.ts";
import { ShellQuoter } from "../../src/rewrite/shell-quoter.ts";

const quoter = new ShellQuoter();

function wrap(quoted: string, context: "unquoted" | "double" | "single"): string {
    if (context === "unquoted") {
        return `x ${quoted}`;
    }
    if (context === "double") {
        return `x "${quoted}"`;
    }
    return `x '${quoted}'`;
}

/** Quotes `value` and reads it back through the real parser and interpreter. */
function roundTrip(
    value: string,
    context: "unquoted" | "double" | "single",
): string | undefined {
    const command = wrap(quoter.quote(value, context), context);
    const result = createInterpreter().interpret(command, {
        cwd: "/",
        variables: {},
        complete: true,
    });
    if (!result.parse.ok) {
        return undefined;
    }
    return result.invocations[0]?.argv[1]?.value;
}

describe("ShellQuoter", () => {
    test("leaves safe words bare", () => {
        expect(quoter.quote("abc")).toBe("abc");
        expect(quoter.quote("a/b.py")).toBe("a/b.py");
        expect(quoter.quote("-x")).toBe("-x");
        expect(quoter.quote("a=b,c:d@e%f+g")).toBe("a=b,c:d@e%f+g");
    });

    test("quotes empty, spaced and special values", () => {
        expect(quoter.quote("")).toBe("''");
        expect(quoter.quote("a b")).toBe("'a b'");
        expect(quoter.quote("a'b")).toBe("'a'\\''b'");
        expect(quoter.quote("a$b")).toBe("'a$b'");
        expect(quoter.quote("a*b")).toBe("'a*b'");
    });

    test("quotes leading tilde and hash", () => {
        expect(quoter.quote("~x")).toBe("'~x'");
        expect(quoter.quote("#x")).toBe("'#x'");
    });

    test("escapes only what matters inside double quotes", () => {
        expect(quoter.quote('a"b', "double")).toBe('a\\"b');
        expect(quoter.quote("a$b", "double")).toBe("a\\$b");
        expect(quoter.quote("a`b", "double")).toBe("a\\`b");
        expect(quoter.quote("a\\b", "double")).toBe("a\\\\b");
    });

    test("escapes single quotes inside single quotes", () => {
        expect(quoter.quote("a'b", "single")).toBe("a'\\''b");
    });

    const TRICKY = [
        "",
        "a b",
        "a'b",
        'a"b',
        "a\\b",
        "$HOME",
        "`id`",
        "a\nb",
        "!",
        "héllo — ünïcode",
        "*",
        "?",
        "[a]",
        "~x",
        "#c",
        "a;b",
        "a|b",
        "a&b",
        "a>b",
        "$(id)",
        "${x}",
        "-n",
        "A=B",
        "\t",
        "  ",
        "a\tb\nc",
    ];

    for (const context of ["unquoted", "double", "single"] as const) {
        test(`round-trips tricky values through the parser (${context})`, () => {
            for (const value of TRICKY) {
                expect(roundTrip(value, context)).toBe(value);
            }
        });
    }

    test("round-trips a fuzz set of generated values", () => {
        const alphabet = [
            "a",
            "b",
            " ",
            "$",
            "'",
            '"',
            "\\",
            "`",
            "*",
            "?",
            "[",
            "]",
            "{",
            "}",
            "~",
            "#",
            "!",
            ";",
            "\n",
            "\t",
        ];
        let seed = 123456789;
        const next = (): number => {
            seed = (seed * 1103515245 + 12345) % 2147483648;
            return seed;
        };
        for (let iteration = 0; iteration < 500; iteration += 1) {
            const length = next() % 8;
            let value = "";
            for (let index = 0; index < length; index += 1) {
                value += alphabet[next() % alphabet.length] as string;
            }
            expect(roundTrip(value, "unquoted")).toBe(value);
            expect(roundTrip(value, "double")).toBe(value);
            expect(roundTrip(value, "single")).toBe(value);
        }
    });
});
