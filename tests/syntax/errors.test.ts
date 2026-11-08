import { describe, expect, test } from "bun:test";

import type { HereDoc } from "../../src/syntax/ast.ts";
import { Parser } from "../../src/syntax/parser.ts";
import { createSourceDocument } from "../../src/syntax/source.ts";
import { commandOf, expectParseError } from "./helpers.ts";

const parser = new Parser();

function failure(text: string): {
    message: string;
    span: { start: number; end: number };
} {
    const result = parser.parse(createSourceDocument(text));
    if (result.ok) {
        throw new Error(`expected ${JSON.stringify(text)} to fail to parse`);
    }
    return result.error;
}

describe("parse errors never throw", () => {
    test("unbalanced quotes", () => {
        expect(failure('echo "unterminated').message).toContain("double quote");
        expect(failure("echo 'unterminated").message).toContain("single quote");
        expect(failure("echo $'unterminated").message).toContain("$'");
    });

    test("unbalanced parentheses and braces", () => {
        expect(failure("( echo hi").message).toContain("')'");
        expect(failure("{ echo hi").message).toContain("'}'");
        expect(failure("$(echo hi").message).toContain("')'");
    });

    test("unterminated command and parameter expansions", () => {
        expect(failure("echo ${x").message).toContain("parameter expansion");
        expect(failure("echo $((1 + 2)").message).toContain("arithmetic");
        expect(failure("echo $[1 + 2").message).toContain("arithmetic");
    });

    test("an EOF-terminated heredoc parses with terminated: false", () => {
        const here = commandOf("cat <<EOF\nbody without delimiter", "SimpleCommand")
            .redirects[0]?.target as HereDoc;
        expect(here.delimiter).toBe("EOF");
        expect(here.terminated).toBe(false);
        expect(here.body.value).toBe("body without delimiter");
    });

    test("the error span lies inside the document", () => {
        const text = "echo ${x";
        const error = failure(text);
        expect(error.span.start).toBeGreaterThanOrEqual(0);
        expect(error.span.end).toBeLessThanOrEqual(text.length);
        expect(error.span.start).toBeLessThanOrEqual(error.span.end);
    });
});

describe("bash rejects what we reject", () => {
    test("unexpected reserved words and tokens", () => {
        expect(failure("then").message).toContain("reserved word");
        expect(failure("fi").message).toContain("reserved word");
        expect(failure("echo a )").message).toContain("')'");
    });

    test("empty simple commands and brace groups", () => {
        expectParseError("while; do :; done");
        expectParseError("{ }");
        expectParseError("; echo hi");
    });

    test("a function body must be compound", () => {
        expectParseError("f() echo hi");
    });

    test("array literals only in assignment position", () => {
        expectParseError("echo x=(1 2)");
    });

    test("a comment right after a redirect operator", () => {
        expectParseError("echo >#foo");
    });
});

describe("robustness", () => {
    test("garbage input returns a result instead of throwing", () => {
        const inputs = [
            "",
            "\0\0",
            "((((",
            "))))",
            "[[ [[ [[",
            "echo $((",
            "cat <<",
            "`",
            ";;;",
            "&&",
            "|",
        ];
        for (const input of inputs) {
            const result = parser.parse(createSourceDocument(input));
            expect(typeof result.ok).toBe("boolean");
        }
    });

    test("deeply nested input hits the depth limit instead of overflowing", () => {
        const depth = 5000;
        const text = "echo " + "$(".repeat(depth) + "true" + ")".repeat(depth);
        const result = parser.parse(createSourceDocument(text));
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.message).toContain("depth");
        }
    });

    test("the parser is reusable across documents", () => {
        expect(parser.parse(createSourceDocument("echo a")).ok).toBe(true);
        expect(parser.parse(createSourceDocument("echo ${x")).ok).toBe(false);
        expect(parser.parse(createSourceDocument("echo b")).ok).toBe(true);
    });
});
