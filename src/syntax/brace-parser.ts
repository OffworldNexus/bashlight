// Scanning for a syntactically valid brace expansion is inherently branchy.
/* eslint-disable sonarjs/cognitive-complexity, sonarjs/function-return-type */
/**
 * Brace expansion (`{a,b}`, `{1..3}`). Only recognised when the text between the
 * braces has a top-level comma or `..` and no unquoted blanks or metacharacters,
 * matching bash; otherwise `{` and `}` stay literal.
 */

import type { BraceExpansionPart, Word } from "./ast.ts";
import { scanDelimited, skipQuoted } from "./scan.ts";
import type { ParseSession } from "./session.ts";
import { parseWordOrEmpty } from "./word-parser.ts";

export function tryParseBraceExpansion(
    session: ParseSession,
): BraceExpansionPart | undefined {
    const start = session.pos;
    const text = session.text;
    let i = start + 1;
    let depth = 1;
    let topComma = false;
    let topDots = false;
    while (i < text.length) {
        const ch = text[i];
        if (ch === "\\") {
            i += 2;
            continue;
        }
        if (ch === "'" || ch === '"' || ch === "`") {
            i = skipQuoted(text, i);
            continue;
        }
        if (ch === "$" && text[i + 1] === "{") {
            i = scanDelimited(text, i + 2, "{", "}", false).end;
            continue;
        }
        if (ch === "$" && text[i + 1] === "(") {
            i = scanDelimited(text, i + 2, "(", ")", false).end;
            continue;
        }
        if (ch === "{") {
            depth += 1;
            i += 1;
            continue;
        }
        if (ch === "}") {
            depth -= 1;
            if (depth === 0) {
                break;
            }
            i += 1;
            continue;
        }
        if (depth === 1) {
            if (ch === ",") {
                topComma = true;
            } else if (ch === "." && text[i + 1] === ".") {
                topDots = true;
            } else if (
                ch === " " ||
                ch === "\t" ||
                ch === "\n" ||
                ch === ";" ||
                ch === "&" ||
                ch === "|" ||
                ch === "(" ||
                ch === ")" ||
                ch === "`"
            ) {
                return undefined;
            }
        }
        i += 1;
    }
    if (depth !== 0 || (!topComma && !topDots)) {
        return undefined;
    }
    const close = i;
    session.advance(1);
    const alternatives: Word[] = [];
    for (;;) {
        alternatives.push(
            parseWordOrEmpty(session, { brace: true, stopAtDots: topDots }),
        );
        if (session.pos >= close) {
            break;
        }
        if (session.peek() === ",") {
            session.advance(1);
            continue;
        }
        if (topDots && session.match("..")) {
            session.advance(2);
            continue;
        }
        break;
    }
    if (session.peek() !== "}") {
        session.pos = start;
        return undefined;
    }
    session.advance(1);
    return {
        kind: "BraceExpansion",
        alternatives,
        sequence: topDots && !topComma,
        span: session.span(start, session.pos),
    };
}
