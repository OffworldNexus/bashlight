// Recursive-descent parsing mirrors a branchy grammar and returns optional nodes.
/* eslint-disable sonarjs/cognitive-complexity, sonarjs/function-return-type */
/**
 * Word parsing: unquoted text, quoting, tildes and the `name` tokens used by
 * function definitions and loop headers. Expansions live in `expansion.ts`,
 * quoted bodies in `quoted-body.ts`, brace expansion in `brace-parser.ts`.
 */

import type { TildePart, Word, WordPart } from "./ast.ts";
import { tryParseBraceExpansion } from "./brace-parser.ts";
import { isGlobChar, isWordTerminator } from "./chars.ts";
import {
    parseBacktickPart,
    parseDollar,
    parseProcessSubstitutionPart,
} from "./expansion.ts";
import {
    parseDoubleQuotedPart,
    parseSingleQuotedPart,
    readEscape,
} from "./quoted-body.ts";
import type { ParseSession } from "./session.ts";
import type { Span } from "./source.ts";
import { appendLiteral, combineValues, emptyWord, pushPart } from "./word-util.ts";

export interface WordOptions {
    /** Allow `~` after `:` or `=` in an assignment value. */
    readonly tildeAfterSeparator?: boolean;
    readonly stopAtBracket?: boolean;
    readonly stopAtDots?: boolean;
    /** `case` patterns: stop at `|` and `)`. */
    readonly pattern?: boolean;
    /** Inside `[[ … ]]`: stop at `&&`, `||`, `]]`, parens. */
    readonly test?: boolean;
    /** Inside `{…}` brace expansion: stop at `,` and `}`. */
    readonly brace?: boolean;
}

function isWordDelimiter(session: ParseSession, o: WordOptions): boolean {
    const c = session.peek();
    if (c === "<" || c === ">") {
        return session.peek(1) !== "(";
    }
    if (c === "&") {
        return o.test !== true || session.match("&&");
    }
    if (c === "|") {
        return o.test !== true || session.match("||");
    }
    if (isWordTerminator(c)) {
        return true;
    }
    if (o.stopAtBracket === true && c === "]") {
        return true;
    }
    if (o.stopAtDots === true && session.match("..")) {
        return true;
    }
    if (o.brace === true && (c === "," || c === "}")) {
        return true;
    }
    if (o.test === true && session.match("]]")) {
        return true;
    }
    return false;
}

function tildeAllowedHere(parts: readonly WordPart[], o: WordOptions): boolean {
    if (parts.length === 0) {
        return true;
    }
    if (o.tildeAfterSeparator !== true) {
        return false;
    }
    const last = parts[parts.length - 1];
    if (last !== undefined && last.kind === "Literal") {
        const ch = last.value.slice(-1);
        return ch === ":" || ch === "=";
    }
    return false;
}

export function parseWord(
    session: ParseSession,
    options: WordOptions = {},
): Word | undefined {
    const start = session.pos;
    const parts: WordPart[] = [];
    while (!session.atEnd() && !isWordDelimiter(session, options)) {
        const c = session.peek();
        if (c === "\\") {
            readEscape(session, parts, "any", "");
            continue;
        }
        if (c === "'") {
            parts.push(parseSingleQuotedPart(session));
            continue;
        }
        if (c === '"') {
            parts.push(parseDoubleQuotedPart(session, "DoubleQuoted"));
            continue;
        }
        if (c === "$") {
            pushPart(parts, parseDollar(session, {}));
            continue;
        }
        if (c === "`") {
            if (session.inBacktick()) {
                break;
            }
            parts.push(parseBacktickPart(session));
            continue;
        }
        if (c === "~" && tildeAllowedHere(parts, options)) {
            parts.push(parseTildePart(session));
            continue;
        }
        if (c === "{") {
            const brace = tryParseBraceExpansion(session);
            if (brace !== undefined) {
                parts.push(brace);
                continue;
            }
        }
        if (c === "<" || c === ">") {
            parts.push(parseProcessSubstitutionPart(session));
            continue;
        }
        appendLiteral(parts, c, isGlobChar(c), session.pos, session.pos + 1);
        session.advance(1);
    }
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

/** `parseWord`, but always a word (empty when nothing was consumed). */
export function parseWordOrEmpty(
    session: ParseSession,
    options: WordOptions = {},
): Word {
    return parseWord(session, options) ?? emptyWord(session.pos);
}

function parseTildePart(session: ParseSession): TildePart {
    const start = session.pos;
    session.advance(1);
    let user = "";
    for (;;) {
        const c = session.peek();
        if (
            isWordTerminator(c) ||
            c === "/" ||
            c === ":" ||
            c === "=" ||
            c === "'" ||
            c === '"' ||
            c === "$" ||
            c === "`" ||
            c === "\\"
        ) {
            break;
        }
        user += c;
        session.advance(1);
    }
    return {
        kind: "Tilde",
        user: user === "" ? undefined : user,
        value: "~" + user,
        span: session.span(start, session.pos),
    };
}

/**
 * Reads a "name token": a run of characters up to whitespace or a
 * metacharacter. Bash accepts more than identifiers here (`foo-bar()`,
 * `for x-y in`), so the parser does too. `=` always stops it, so `a=()` is an
 * assignment, never a function definition.
 */
export function scanNameToken(
    session: ParseSession,
): { name: string; span: Span } | undefined {
    const start = session.pos;
    for (;;) {
        const c = session.peek();
        if (
            isWordTerminator(c) ||
            c === "=" ||
            c === "'" ||
            c === '"' ||
            c === "$" ||
            c === "`" ||
            c === "\\"
        ) {
            break;
        }
        session.advance(1);
    }
    if (session.pos === start) {
        return undefined;
    }
    return {
        name: session.slice(start, session.pos),
        span: session.span(start, session.pos),
    };
}

/** Whether the cursor is at the start of a function definition `name (`. */
export function looksLikeFunctionDefinition(session: ParseSession): boolean {
    const saved = session.pos;
    const token = scanNameToken(session);
    if (token === undefined) {
        session.pos = saved;
        return false;
    }
    session.skipBlanks();
    if (session.peek() !== "(") {
        session.pos = saved;
        return false;
    }
    session.advance(1);
    session.skipBlanks();
    const ok = session.peek() === ")";
    session.pos = saved;
    return ok;
}
