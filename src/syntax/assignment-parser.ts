// Recursive-descent parsing mirrors a branchy grammar and returns optional nodes.
/* eslint-disable sonarjs/cognitive-complexity, sonarjs/function-return-type */
/**
 * Assignment parsing. `A=1` and `A[1]=x` are assignments only in assignment
 * position (before the command name); everywhere else they are plain words.
 * `parseAssignmentWord` lets the interpreter recover assignment syntax from such
 * a word (`export A=1`, `local x=$(…)`).
 */

import type { ArrayValue, Assignment, Word } from "./ast.ts";
import { NAME_RE } from "./chars.ts";
import { scanDelimited } from "./scan.ts";
import type { ParseSession } from "./session.ts";
import { parseWordOrEmpty } from "./word-parser.ts";

export function tryParseAssignment(session: ParseSession): Assignment | undefined {
    const start = session.pos;
    const nameMatch = NAME_RE.exec(session.slice(start, session.text.length));
    if (nameMatch === null) {
        return undefined;
    }
    const name = nameMatch[0];
    const nameEnd = start + name.length;

    let index: Word | undefined;
    let afterName = nameEnd;
    if (session.text[nameEnd] === "[") {
        const subscript = scanDelimited(session.text, nameEnd + 1, "[", "]", false);
        if (!subscript.terminated) {
            return undefined;
        }
        const saved = session.pos;
        session.pos = nameEnd + 1;
        index = parseWordOrEmpty(session, { stopAtBracket: true });
        session.pos = saved;
        afterName = subscript.end;
    }

    let append = false;
    let valueStart: number;
    if (session.text[afterName] === "+" && session.text[afterName + 1] === "=") {
        append = true;
        valueStart = afterName + 2;
    } else if (session.text[afterName] === "=") {
        valueStart = afterName + 1;
    } else {
        return undefined;
    }

    session.pos = valueStart;
    let value: Word | ArrayValue;
    if (session.peek() === "(") {
        const arrayStart = session.pos;
        session.advance(1);
        const elements: Word[] = [];
        for (;;) {
            session.skipSeparators();
            if (session.atEnd() || session.peek() === ")") {
                break;
            }
            const element = parseWordOrEmpty(session, { tildeAfterSeparator: true });
            if (element.parts.length === 0) {
                break;
            }
            elements.push(element);
        }
        if (session.peek() !== ")") {
            session.error("expected ')' to close an array assignment");
        }
        session.advance(1);
        value = {
            kind: "ArrayValue",
            elements,
            span: session.span(arrayStart, session.pos),
        };
    } else {
        value = parseWordOrEmpty(session, { tildeAfterSeparator: true });
    }
    const end = session.pos;
    return {
        kind: "Assignment",
        name,
        index,
        append,
        value,
        span: session.span(start, end),
        nameSpan: session.span(start, nameEnd),
        valueSpan: session.span(valueStart, end),
    };
}

export interface AssignmentWord {
    readonly name: string;
    readonly index: string | undefined;
    readonly append: boolean;
    /** Decoded value text, or `undefined` when it is not statically known. */
    readonly value: string | undefined;
}

const FULL_NAME_RE = /^([A-Za-z_]\w*)(?:\[([^\]]*)\])?$/;

/**
 * Interprets a word as `NAME[INDEX]+=VALUE` when it has that shape. Used by the
 * interpreter for `export A=1`-style arguments.
 */
export function parseAssignmentWord(word: Word): AssignmentWord | undefined {
    const first = word.parts[0];
    if (first === undefined || first.kind !== "Literal") {
        return undefined;
    }
    const eq = first.value.indexOf("=");
    if (eq === -1) {
        return undefined;
    }
    let head = first.value.slice(0, eq);
    let append = false;
    if (head.endsWith("+")) {
        append = true;
        head = head.slice(0, -1);
    }
    const m = FULL_NAME_RE.exec(head);
    if (m === null) {
        return undefined;
    }
    const value = word.value === undefined ? undefined : word.value.slice(eq + 1);
    return { name: m[1] ?? "", index: m[2], append, value };
}
