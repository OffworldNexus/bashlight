// `${…}` parameter expansions: name, subscript, operator and operand.
/* eslint-disable sonarjs/cognitive-complexity, sonarjs/function-return-type */
/**
 * Braced parameter expansions. The operand of an operator is parsed with the
 * shared quoted-body scanner because `${x:-a b}` allows spaces and
 * metacharacters that a normal word would stop at.
 */

import type { ParameterExpansionPart, Word, WordPart } from "./ast.ts";
import { isDigit, isNameChar, isNameStart } from "./chars.ts";
import { PARAMETER_ARGUMENT_BODY, parseQuotedBody } from "./quoted-body.ts";
import type { ParseSession } from "./session.ts";
import { parseWordOrEmpty } from "./word-parser.ts";
import { combineValues } from "./word-util.ts";

/** The operand of a parameter operator (`${x:-…}`); only an unquoted `}` ends it. */
function parseParameterArgument(session: ParseSession): Word | undefined {
    const start = session.pos;
    const parts: WordPart[] = parseQuotedBody(
        session,
        (s) => s.peek() === "}",
        PARAMETER_ARGUMENT_BODY,
        "unterminated parameter expansion",
    );
    if (parts.length === 0) {
        return undefined;
    }
    return {
        kind: "Word",
        parts,
        value: combineValues(parts),
        span: session.span(start, session.pos),
    };
}

export function parseParameterExpansion(
    session: ParseSession,
    start: number,
): ParameterExpansionPart {
    session.advance(1);
    let length = false;
    let indirect = false;
    if (session.peek() === "#" && session.peek(1) !== "}") {
        length = true;
        session.advance(1);
    } else if (session.peek() === "!") {
        indirect = true;
        session.advance(1);
    }
    let name: string;
    const c = session.peek();
    if (isNameStart(c)) {
        const nameStart = session.pos;
        while (isNameChar(session.peek())) {
            session.advance(1);
        }
        name = session.slice(nameStart, session.pos);
    } else if (isDigit(c)) {
        const nameStart = session.pos;
        while (isDigit(session.peek())) {
            session.advance(1);
        }
        name = session.slice(nameStart, session.pos);
    } else if (c !== "" && c !== "}") {
        name = c;
        session.advance(1);
    } else {
        session.error(
            "unterminated parameter expansion",
            session.span(start, session.pos),
        );
    }

    let index: Word | undefined;
    if (session.peek() === "[") {
        session.advance(1);
        index = parseWordOrEmpty(session, { stopAtBracket: true });
        if (session.peek() === "]") {
            session.advance(1);
        }
    }

    let operator: string | undefined;
    let argument: Word | undefined;
    if (session.peek() !== "}" && session.peek() !== "") {
        operator = readParameterOperator(session);
        if (operator === undefined) {
            session.error(
                "unsupported parameter operator",
                session.span(start, session.pos),
            );
        }
        if (!operator.startsWith("@")) {
            argument = parseParameterArgument(session);
        }
    }

    if (session.peek() !== "}") {
        session.error(
            "unterminated parameter expansion",
            session.span(start, session.pos),
        );
    }
    session.advance(1);
    return {
        kind: "ParameterExpansion",
        name,
        simple: false,
        index,
        operator,
        argument,
        length,
        indirect,
        span: session.span(start, session.pos),
    };
}

function readParameterOperator(session: ParseSession): string | undefined {
    const c = session.peek();
    const d = session.peek(1);
    switch (c) {
        case ":":
            if (d === "-" || d === "=" || d === "?" || d === "+") {
                session.advance(2);
                return c + d;
            }
            session.advance(1);
            return ":";
        case "-":
        case "=":
        case "?":
        case "+":
            session.advance(1);
            return c;
        case "#":
            if (d === "#") {
                session.advance(2);
                return "##";
            }
            session.advance(1);
            return "#";
        case "%":
            if (d === "%") {
                session.advance(2);
                return "%%";
            }
            session.advance(1);
            return "%";
        case "/":
            if (d === "/") {
                session.advance(2);
                return "//";
            }
            if (d === "#" || d === "%") {
                session.advance(2);
                return "/" + d;
            }
            session.advance(1);
            return "/";
        case "^":
            if (d === "^") {
                session.advance(2);
                return "^^";
            }
            session.advance(1);
            return "^";
        case ",":
            if (d === ",") {
                session.advance(2);
                return ",,";
            }
            session.advance(1);
            return ",";
        case "@": {
            const transform = session.peek(1);
            if (
                (transform >= "A" && transform <= "Z") ||
                (transform >= "a" && transform <= "z")
            ) {
                session.advance(2);
                return "@" + transform;
            }
            session.advance(1);
            return "@";
        }
        case "*":
            session.advance(1);
            return "*";
        default:
            return undefined;
    }
}
