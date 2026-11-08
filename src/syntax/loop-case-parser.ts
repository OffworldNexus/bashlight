// For/select/case headers and items.

/**
 * `for` / `select` / `case`: their headers, item lists and terminators. Kept
 * apart from the other compounds because a `case` item is a small grammar of
 * its own (patterns, `)`, body, `;;`/`;&`/`;;&`).
 */

import type {
    ArithmeticHeader,
    Case,
    CaseItem,
    CaseTerminator,
    For,
    ForHeader,
    Select,
    Word,
} from "./ast.ts";
import { parseScript } from "./parser.ts";
import { parseTrailingRedirects } from "./redirect-parser.ts";
import { peekReservedWord } from "./reserved.ts";
import { scanDelimited } from "./scan.ts";
import type { ParseSession } from "./session.ts";
import { stops } from "./stops.ts";
import { parseWord, parseWordOrEmpty, scanNameToken } from "./word-parser.ts";

function skipToReserved(session: ParseSession, word: string): void {
    for (;;) {
        session.skipBlanks();
        if (peekReservedWord(session) === word) {
            return;
        }
        const c = session.peek();
        if (c === ";") {
            session.advance(1);
            continue;
        }
        if (c === "\n") {
            session.consumeNewline();
            continue;
        }
        if (c === "#") {
            session.consumeComment();
            continue;
        }
        session.error(`expected '${word}'`);
    }
}

function parseForHeader(session: ParseSession, keywordLength: number): ForHeader {
    const start = session.pos;
    session.advance(keywordLength);
    session.skipBlanks();
    if (session.match("((")) {
        const arithmeticStart = session.pos;
        session.advance(2);
        const exprStart = session.pos;
        const scan = scanDelimited(session.text, exprStart, "(", ")", true);
        if (!scan.terminated) {
            session.error(
                "unterminated arithmetic for",
                session.span(start, session.pos),
            );
        }
        const segments = session.slice(exprStart, scan.end - 2).split(";");
        session.pos = scan.end;
        const arithmetic: ArithmeticHeader = {
            kind: "ArithmeticHeader",
            init: (segments[0] ?? "").trim(),
            condition: (segments[1] ?? "").trim(),
            update: (segments[2] ?? "").trim(),
            span: session.span(arithmeticStart, session.pos),
        };
        return {
            kind: "ForHeader",
            name: undefined,
            nameSpan: undefined,
            arithmetic,
            items: [],
            span: session.span(start, session.pos),
        };
    }
    const nameToken = scanNameToken(session);
    if (nameToken === undefined) {
        session.error(
            "expected a loop variable name",
            session.span(start, session.pos),
        );
    }
    session.skipBlanks();
    const items: Word[] = [];
    if (peekReservedWord(session) === "in") {
        session.advance(2);
        for (;;) {
            session.skipBlanks();
            const c = session.peek();
            if (c === "" || c === ";" || c === "\n" || c === "#") {
                break;
            }
            const word = parseWord(session, {});
            if (word === undefined) {
                break;
            }
            items.push(word);
        }
    }
    return {
        kind: "ForHeader",
        name: nameToken.name,
        nameSpan: nameToken.span,
        arithmetic: undefined,
        items,
        span: session.span(start, session.pos),
    };
}

/** `for` and `select` share everything but the node kind. */
function parseForOrSelect(
    session: ParseSession,
    kind: "For" | "Select",
    keywordLength: number,
): For | Select {
    const start = session.pos;
    const header = parseForHeader(session, keywordLength);
    skipToReserved(session, "do");
    session.advance(2);
    const body = parseScript(session, stops({ words: ["done"] })).body;
    session.skipBlanks();
    if (peekReservedWord(session) !== "done") {
        session.error("expected 'done'", session.span(start, session.pos));
    }
    session.advance(4);
    const redirects = parseTrailingRedirects(session);
    const common = { header, body, redirects, span: session.span(start, session.pos) };
    return kind === "For" ? { kind: "For", ...common } : { kind: "Select", ...common };
}

export function parseFor(session: ParseSession): For {
    return parseForOrSelect(session, "For", 3) as For;
}

export function parseSelect(session: ParseSession): Select {
    return parseForOrSelect(session, "Select", 6) as Select;
}

export function parseCase(session: ParseSession): Case {
    const start = session.pos;
    session.advance(4);
    session.skipBlanks();
    const word = parseWord(session, {});
    if (word === undefined) {
        session.error("expected a word after 'case'");
    }
    session.skipBlanks();
    if (peekReservedWord(session) === "in") {
        session.advance(2);
    } else {
        skipToReserved(session, "in");
        session.advance(2);
    }
    const items: CaseItem[] = [];
    for (;;) {
        session.skipSeparators();
        if (peekReservedWord(session) === "esac") {
            break;
        }
        if (session.atEnd()) {
            session.error("expected 'esac'", session.span(start, session.pos));
        }
        items.push(parseCaseItem(session));
    }
    session.advance(4);
    const redirects = parseTrailingRedirects(session);
    return {
        kind: "Case",
        word,
        items,
        redirects,
        span: session.span(start, session.pos),
    };
}

function parseCaseItem(session: ParseSession): CaseItem {
    const start = session.pos;
    session.skipBlanks();
    if (session.peek() === "(") {
        session.advance(1);
    }
    const patterns: Word[] = [];
    for (;;) {
        session.skipBlanks();
        patterns.push(parseWordOrEmpty(session, { pattern: true }));
        session.skipBlanks();
        if (session.peek() === "|") {
            session.advance(1);
            continue;
        }
        break;
    }
    if (session.peek() !== ")") {
        session.error(
            "expected ')' after a case pattern",
            session.span(start, session.pos),
        );
    }
    session.advance(1);
    const body = parseScript(
        session,
        stops({ caseTerminator: true, words: ["esac"] }),
    ).body;
    let terminator: CaseTerminator | undefined;
    if (session.match(";;&")) {
        terminator = ";;&";
        session.advance(3);
    } else if (session.match(";;")) {
        terminator = ";;";
        session.advance(2);
    } else if (session.match(";&")) {
        terminator = ";&";
        session.advance(2);
    }
    return {
        kind: "CaseItem",
        patterns,
        body,
        terminator,
        span: session.span(start, session.pos),
    };
}
