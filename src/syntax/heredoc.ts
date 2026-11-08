// Parsing a heredoc body mirrors the branchy double-quote scanner.
/* eslint-disable sonarjs/function-return-type */
/**
 * Heredoc bodies. A body is read as raw lines up to the delimiter, then parsed
 * like a double-quoted string (quotes are literal, `\` escapes `$`, `` ` ``, `\`
 * and newline) unless the delimiter was quoted, in which case it stays literal.
 */

import type { Word, WordPart } from "./ast.ts";
import { HEREDOC_BODY, parseQuotedBody } from "./quoted-body.ts";
import type { ParseSession } from "./session.ts";
import type { Span } from "./source.ts";
import { combineValues } from "./word-util.ts";

export function parseHeredocBody(
    session: ParseSession,
    bodySpan: Span,
    quoted: boolean,
    stripTabs: boolean,
): Word {
    let parts: WordPart[];
    if (quoted) {
        const raw = session.slice(bodySpan.start, bodySpan.end);
        parts =
            raw.length > 0
                ? [{ kind: "Literal", value: raw, hasGlob: false, span: bodySpan }]
                : [];
    } else {
        const saved = session.pos;
        session.pos = bodySpan.start;
        parts = parseQuotedBody(
            session,
            (s) => s.pos >= bodySpan.end,
            HEREDOC_BODY,
            "unterminated heredoc body",
        );
        session.pos = saved;
    }
    if (stripTabs) {
        parts = stripLeadingTabsFromParts(parts);
    }
    return { kind: "Word", parts, value: combineValues(parts), span: bodySpan };
}

/** `<<-` strips the leading tabs of every line, from decoded literal text. */
function stripLeadingTabsFromParts(parts: readonly WordPart[]): WordPart[] {
    let atLineStart = true;
    return parts.map((part) => {
        if (part.kind !== "Literal") {
            atLineStart = false;
            return part;
        }
        let out = "";
        for (const ch of part.value) {
            if (atLineStart && ch === "\t") {
                continue;
            }
            out += ch;
            atLineStart = ch === "\n";
        }
        return { ...part, value: out };
    });
}
