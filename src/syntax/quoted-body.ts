// Quoted bodies share the backslash step with plain words.
/* eslint-disable sonarjs/cognitive-complexity, sonarjs/function-return-type */
/**
 * Bodies of the three "quoted" regions the shell expands inside: `"…"`, an
 * unquoted heredoc body, and the operand of a parameter operator (`${x:-…}`).
 * They differ only in what terminates them and which characters are special, so
 * one scanner covers all three and shares the backslash step with plain words.
 */

import type {
    DoubleQuotedPart,
    LocaleQuotedPart,
    SingleQuotedPart,
    WordPart,
} from "./ast.ts";
import { parseBacktickPart, parseDollar } from "./expansion.ts";
import type { ParseSession } from "./session.ts";
import {
    appendLiteral,
    combineValues,
    extendLastLiteral,
    pushPart,
} from "./word-util.ts";

const DOUBLE_QUOTE_ESCAPES = '$`"\\';
const HEREDOC_ESCAPES = "$`\\";

export interface QuotedBodyOptions {
    /** `'…'` starts a quoted part (parameter operands) rather than literal text. */
    readonly singleQuotedPart: boolean;
    /** `"…"` starts a quoted part (parameter operands) rather than literal text. */
    readonly doubleQuoted: "part" | "literal";
    /** `double` escapes only `escapedChars`; `any` escapes any character. */
    readonly escapeMode: "double" | "any";
    readonly escapedChars: string;
    readonly inDoubleQuotes: boolean;
}

export const DOUBLE_QUOTED_BODY: QuotedBodyOptions = {
    singleQuotedPart: false,
    doubleQuoted: "literal",
    escapeMode: "double",
    escapedChars: DOUBLE_QUOTE_ESCAPES,
    inDoubleQuotes: true,
};

export const HEREDOC_BODY: QuotedBodyOptions = {
    singleQuotedPart: false,
    doubleQuoted: "literal",
    escapeMode: "double",
    escapedChars: HEREDOC_ESCAPES,
    inDoubleQuotes: true,
};

export const PARAMETER_ARGUMENT_BODY: QuotedBodyOptions = {
    singleQuotedPart: true,
    doubleQuoted: "part",
    escapeMode: "any",
    escapedChars: "",
    inDoubleQuotes: false,
};

/** Consumes one `\…` escape (or a line continuation) into `parts`. */
export function readEscape(
    session: ParseSession,
    parts: WordPart[],
    mode: "double" | "any",
    escapedChars: string,
): void {
    const next = session.peek(1);
    if (next === "\n") {
        session.advance(2);
        extendLastLiteral(parts, session.pos);
        return;
    }
    if (next === "") {
        appendLiteral(parts, "\\", false, session.pos, session.pos + 1);
        session.advance(1);
        return;
    }
    if (mode === "any" || escapedChars.includes(next)) {
        appendLiteral(parts, next, false, session.pos, session.pos + 2);
        session.advance(2);
        return;
    }
    appendLiteral(parts, "\\", false, session.pos, session.pos + 1);
    session.advance(1);
}

/** Parses parts until `stop` reports the terminator; never consumes it. */
export function parseQuotedBody(
    session: ParseSession,
    stop: (session: ParseSession) => boolean,
    options: QuotedBodyOptions,
    unterminated: string,
): WordPart[] {
    const parts: WordPart[] = [];
    while (!stop(session)) {
        if (session.atEnd()) {
            session.error(unterminated);
        }
        const c = session.peek();
        if (c === "\\") {
            readEscape(session, parts, options.escapeMode, options.escapedChars);
            continue;
        }
        if (c === "'" && options.singleQuotedPart) {
            parts.push(parseSingleQuotedPart(session));
            continue;
        }
        if (c === '"' && options.doubleQuoted === "part") {
            parts.push(parseDoubleQuotedPart(session, "DoubleQuoted"));
            continue;
        }
        if (c === "$") {
            pushPart(
                parts,
                parseDollar(session, { inDoubleQuotes: options.inDoubleQuotes }),
            );
            continue;
        }
        if (c === "`") {
            if (session.inBacktick()) {
                break;
            }
            parts.push(parseBacktickPart(session));
            continue;
        }
        appendLiteral(parts, c, false, session.pos, session.pos + 1);
        session.advance(1);
    }
    return parts;
}

export function parseSingleQuotedPart(session: ParseSession): SingleQuotedPart {
    const start = session.pos;
    session.advance(1);
    const contentStart = session.pos;
    while (!session.atEnd() && session.peek() !== "'") {
        session.advance(1);
    }
    if (session.atEnd()) {
        session.error("unterminated single quote");
    }
    const value = session.slice(contentStart, session.pos);
    session.advance(1);
    return { kind: "SingleQuoted", value, span: session.span(start, session.pos) };
}

/** Parses a `"…"` (or `$"…"`) starting at the opening quote. */
export function parseDoubleQuotedPart(
    session: ParseSession,
    kind: "DoubleQuoted" | "LocaleQuoted",
    start = session.pos,
): DoubleQuotedPart | LocaleQuotedPart {
    session.advance(1);
    const parts = parseQuotedBody(
        session,
        (s) => s.peek() === '"',
        DOUBLE_QUOTED_BODY,
        "unterminated double quote",
    );
    if (session.atEnd()) {
        session.error("unterminated double quote");
    }
    session.advance(1);
    const span = session.span(start, session.pos);
    if (kind === "LocaleQuoted") {
        return { kind: "LocaleQuoted", parts, value: combineValues(parts), span };
    }
    return { kind: "DoubleQuoted", parts, value: combineValues(parts), span };
}
