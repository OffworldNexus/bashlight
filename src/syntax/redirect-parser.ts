// Recursive-descent parsing mirrors a branchy grammar and returns optional nodes.
/* eslint-disable sonarjs/function-return-type */
/**
 * Redirection parsing, including heredocs. A heredoc body starts after the next
 * newline, so the redirect is built with a provisional `HereDoc` and queued; when
 * the newline is consumed the body is read and the final node recorded, and the
 * whole tree is rewritten once at the end of the parse (`resolveHeredocs`).
 */

import type { HereDoc, Redirect, RedirectFd, RedirectOperator } from "./ast.ts";
import { parseHeredocBody } from "./heredoc.ts";
import type { ParseSession, PendingHeredoc } from "./session.ts";
import { parseWord } from "./word-parser.ts";
import { emptyWord } from "./word-util.ts";

interface RedirectHead {
    readonly fd: RedirectFd;
    readonly operator: RedirectOperator;
}

function isRedirectOpStart(c: string): boolean {
    return c === "<" || c === ">";
}

export function tryParseRedirect(session: ParseSession): Redirect | undefined {
    const start = session.pos;
    const c = session.peek();

    if (c === "&") {
        if (session.match("&>>")) {
            session.advance(3);
            return finishRedirect(session, start, { fd: undefined, operator: "&>>" });
        }
        if (session.match("&>")) {
            session.advance(2);
            return finishRedirect(session, start, { fd: undefined, operator: "&>" });
        }
        return undefined;
    }

    let fd: RedirectFd;
    let operatorAt = start;

    if (c === "<" || c === ">") {
        fd = undefined;
    } else if (c === "{") {
        const m = /^\{([A-Za-z_]\w*)\}/.exec(session.slice(start, session.text.length));
        if (m === null || !isRedirectOpStart(session.text[start + m[0].length] ?? "")) {
            return undefined;
        }
        fd = { kind: "var", name: m[1] ?? "" };
        operatorAt = start + m[0].length;
    } else if (c >= "0" && c <= "9") {
        const m = /^\d+/.exec(session.slice(start, session.text.length));
        if (m === null || !isRedirectOpStart(session.text[start + m[0].length] ?? "")) {
            return undefined;
        }
        fd = { kind: "number", fd: Number.parseInt(m[0], 10) };
        operatorAt = start + m[0].length;
    } else {
        return undefined;
    }

    session.pos = operatorAt;
    const operator = readRedirectOperator(session);
    if (operator === undefined) {
        session.pos = start;
        return undefined;
    }
    return finishRedirect(session, start, { fd, operator });
}

function readRedirectOperator(session: ParseSession): RedirectOperator | undefined {
    const candidates: readonly RedirectOperator[] = [
        "<<<",
        "<<-",
        "<<",
        "<>",
        ">>",
        ">|",
        "<&",
        ">&",
    ];
    for (const candidate of candidates) {
        if (session.match(candidate)) {
            session.advance(candidate.length);
            return candidate;
        }
    }
    if (session.peek() === "<" && session.peek(1) !== "(") {
        session.advance(1);
        return "<";
    }
    if (session.peek() === ">" && session.peek(1) !== "(") {
        session.advance(1);
        return ">";
    }
    return undefined;
}

function finishRedirect(
    session: ParseSession,
    start: number,
    head: RedirectHead,
): Redirect {
    if (head.operator === "<<" || head.operator === "<<-") {
        return parseHeredocRedirect(session, start, head);
    }
    session.skipBlanks();
    const target = parseTargetWord(session);
    return {
        kind: "Redirect",
        fd: head.fd,
        operator: head.operator,
        target,
        span: session.span(start, session.pos),
    };
}

function parseTargetWord(session: ParseSession): NonNullable<Redirect["target"]> {
    if (session.peek() === "#") {
        session.error("expected a redirection target");
    }
    const target = parseWord(session, {});
    if (target === undefined) {
        session.error("expected a redirection target");
    }
    return target;
}

function parseHeredocRedirect(
    session: ParseSession,
    start: number,
    head: RedirectHead,
): Redirect {
    session.skipBlanks();
    if (session.peek() === "#") {
        session.error("expected a heredoc delimiter");
    }
    const delimWord = parseWord(session, {});
    if (delimWord === undefined) {
        session.error("expected a heredoc delimiter");
    }
    const raw = session.slice(delimWord.span.start, delimWord.span.end);
    const quoted = raw.includes("'") || raw.includes('"') || raw.includes("\\");
    const delimiter = delimWord.value ?? raw;
    const stripTabs = head.operator === "<<-";
    const placeholder: HereDoc = {
        kind: "HereDoc",
        delimiter,
        quoted,
        stripTabs,
        // Provisional; replaced by the final node once the body is read.
        terminated: true,
        body: emptyWord(session.pos),
        bodySpan: session.span(session.pos, session.pos),
        span: session.span(start, delimWord.span.end),
    };
    const pending: PendingHeredoc = { placeholder, delimiter, quoted, stripTabs };
    session.addPendingHeredoc(pending);
    return {
        kind: "Redirect",
        fd: head.fd,
        operator: head.operator,
        target: placeholder,
        span: session.span(start, session.pos),
    };
}

/** Reads the target of a redirection that is a word (not a heredoc). */
export function parseTrailingRedirects(session: ParseSession): Redirect[] {
    const redirects: Redirect[] = [];
    for (;;) {
        session.skipBlanks();
        const redirect = tryParseRedirect(session);
        if (redirect === undefined) {
            break;
        }
        redirects.push(redirect);
    }
    return redirects;
}

/** Reads every queued heredoc body starting at the current (post-newline) cursor. */
export function readPendingHeredocs(session: ParseSession): void {
    if (!session.beginHeredocRead()) {
        return;
    }
    try {
        for (;;) {
            const pending = session.shiftPendingHeredoc();
            if (pending === undefined) {
                break;
            }
            readOneHeredoc(session, pending);
        }
    } finally {
        session.endHeredocRead();
    }
}

function readOneHeredoc(session: ParseSession, pending: PendingHeredoc): void {
    const bodyStart = session.pos;
    let bodyEnd = bodyStart;
    let terminated = false;
    while (!session.atEnd()) {
        const newline = session.text.indexOf("\n", session.pos);
        const lineEnd = newline === -1 ? session.text.length : newline;
        const line = session.slice(session.pos, lineEnd);
        const compare = pending.stripTabs ? line.replace(/^\t+/, "") : line;
        if (compare === pending.delimiter) {
            terminated = true;
            session.pos = newline === -1 ? session.text.length : newline + 1;
            break;
        }
        session.pos = newline === -1 ? session.text.length : newline + 1;
        bodyEnd = session.pos;
    }
    const bodySpan = session.span(bodyStart, bodyEnd);
    const final: HereDoc = {
        kind: "HereDoc",
        delimiter: pending.delimiter,
        quoted: pending.quoted,
        stripTabs: pending.stripTabs,
        terminated,
        body: parseHeredocBody(session, bodySpan, pending.quoted, pending.stripTabs),
        bodySpan,
        span: pending.placeholder.span,
    };
    session.recordHeredocFinal(pending.placeholder, final);
}

/**
 * Replaces every provisional `HereDoc` with the node built once its body was
 * read. Walks the tree reflectively (nodes are plain, acyclic data) and only
 * runs when the script actually contains heredocs.
 */
export function resolveHeredocs<T>(root: T, finals: ReadonlyMap<HereDoc, HereDoc>): T {
    if (finals.size === 0) {
        return root;
    }
    return replace(root, finals) as T;
}

function replace(value: unknown, finals: ReadonlyMap<HereDoc, HereDoc>): unknown {
    if (Array.isArray(value)) {
        return value.map((item) => replace(item, finals));
    }
    if (value === null || typeof value !== "object") {
        return value;
    }
    const mapped = finals.get(value as HereDoc);
    if (mapped !== undefined) {
        return replace(mapped, finals);
    }
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
        out[key] = replace(source[key], finals);
    }
    return out;
}
