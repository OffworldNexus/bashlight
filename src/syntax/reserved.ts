// Reserved-word recognition returns an optional token.
/* eslint-disable sonarjs/function-return-type */
/**
 * Reserved-word recognition. Bash only reserves these words in command
 * position, so callers must ask *before* parsing a command, never while reading
 * an argument (`echo if then` has no reserved words). The table is the single
 * source for the reserved words, the list terminators and the compound starts.
 */

import { isNameStart, isWordTerminator, NAME_RE } from "./chars.ts";
import type { ParseSession } from "./session.ts";

interface ReservedDefinition {
    readonly word: string;
    readonly terminator?: boolean;
    readonly compound?: boolean;
}

const RESERVED_DEFINITIONS: readonly ReservedDefinition[] = [
    { word: "if", compound: true },
    { word: "then", terminator: true },
    { word: "elif", terminator: true },
    { word: "else", terminator: true },
    { word: "fi", terminator: true },
    { word: "do", terminator: true },
    { word: "done", terminator: true },
    { word: "case", compound: true },
    { word: "esac", terminator: true },
    { word: "while", compound: true },
    { word: "until", compound: true },
    { word: "for", compound: true },
    { word: "in", terminator: true },
    { word: "function", compound: true },
    { word: "select", compound: true },
    { word: "time" },
    { word: "coproc", compound: true },
];

function wordsWith(
    predicate: (definition: ReservedDefinition) => boolean,
): Set<string> {
    return new Set(
        RESERVED_DEFINITIONS.filter(predicate).map((definition) => definition.word),
    );
}

export const RESERVED_WORDS: ReadonlySet<string> = new Set(
    RESERVED_DEFINITIONS.map((definition) => definition.word),
);

/** Words that end a command list (`fi`, `done`, `esac`, `}`, `]]`, …). */
export const TERMINATOR_WORDS: ReadonlySet<string> = new Set([
    ...wordsWith((definition) => definition.terminator === true),
    "}",
    "]]",
]);

/** Tokens that can start a compound command. */
export const COMPOUND_STARTS: ReadonlySet<string> = new Set([
    "{",
    "[[",
    ...wordsWith((definition) => definition.compound === true),
]);

/** Whether the character at `pos + offset` can follow a standalone token. */
export function isTokenBoundary(session: ParseSession, offset: number): boolean {
    return isWordTerminator(session.peek(offset));
}

/** The reserved word starting at the cursor, or `undefined`. Does not advance. */
export function peekReservedWord(session: ParseSession): string | undefined {
    if (session.match("[[") && isTokenBoundary(session, 2)) {
        return "[[";
    }
    if (session.match("]]") && isTokenBoundary(session, 2)) {
        return "]]";
    }
    const c = session.peek();
    if (c === "!" && isTokenBoundary(session, 1)) {
        return "!";
    }
    if (c === "{" && isTokenBoundary(session, 1)) {
        return "{";
    }
    if (c === "}" && isTokenBoundary(session, 1)) {
        return "}";
    }
    if (isNameStart(c)) {
        const m = NAME_RE.exec(session.slice(session.pos, session.text.length));
        if (
            m !== null &&
            isTokenBoundary(session, m[0].length) &&
            RESERVED_WORDS.has(m[0])
        ) {
            return m[0];
        }
    }
    return undefined;
}
