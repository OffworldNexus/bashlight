// Character predicates and the identifier reader.
/* eslint-disable sonarjs/function-return-type */
/** Small character predicates shared across the scanners. */

import type { ParseSession } from "./session.ts";
import type { Span } from "./source.ts";

export function isNameStart(c: string): boolean {
    return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
}

export function isNameChar(c: string): boolean {
    return isNameStart(c) || (c >= "0" && c <= "9");
}

export function isDigit(c: string): boolean {
    return c >= "0" && c <= "9";
}

export function isGlobChar(c: string): boolean {
    return c === "*" || c === "?" || c === "[";
}

/**
 * Characters that end an unquoted word in every shell context: blanks and
 * metacharacters. `\r` is deliberately absent — bash treats it as an ordinary
 * character, so `echo hi\r\n` has the single word `hi\r`.
 */
export const WORD_TERMINATORS = " \t\n;&|()<>";

export function isWordTerminator(c: string): boolean {
    return c === "" || WORD_TERMINATORS.includes(c);
}

export const NAME_RE = /^[A-Za-z_]\w*/;

/** Reads a shell identifier (`[A-Za-z_][A-Za-z0-9_]*`), or `undefined`. */
export function readName(
    session: ParseSession,
): { name: string; span: Span } | undefined {
    const start = session.pos;
    if (!isNameStart(session.peek())) {
        return undefined;
    }
    session.advance(1);
    while (isNameChar(session.peek())) {
        session.advance(1);
    }
    return {
        name: session.slice(start, session.pos),
        span: session.span(start, session.pos),
    };
}
