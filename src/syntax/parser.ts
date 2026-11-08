// Recursive-descent parsing mirrors a branchy grammar and returns optional nodes.
/* eslint-disable sonarjs/cognitive-complexity, sonarjs/function-return-type */
/**
 * The recursive-descent parser. `Parser` is a stateless, reusable object; all
 * mutable state lives in a `ParseSession` created per `parse` call, and every
 * failure is caught and returned as a `ParseResult` (fail open).
 */

import { tryParseAssignment } from "./assignment-parser.ts";
import type {
    AndOr,
    AndOrLink,
    Assignment,
    Command,
    CommandList,
    CommandListItem,
    ParseResult,
    Pipeline,
    PipelineMember,
    Redirect,
    Script,
    Separator,
    SimpleCommand,
    TimeKeyword,
    Word,
} from "./ast.ts";
import { isNameStart } from "./chars.ts";
import {
    parseArithmeticCommand,
    parseBraceGroup,
    parseCoproc,
    parseFunctionDefinition,
    parseIf,
    parseLoop,
    parseSubshell,
    parseTestCommand,
} from "./compound-parser.ts";
import { ParseAbort } from "./errors.ts";
import { parseCase, parseFor, parseSelect } from "./loop-case-parser.ts";
import {
    readPendingHeredocs,
    resolveHeredocs,
    tryParseRedirect,
} from "./redirect-parser.ts";
import { isTokenBoundary, peekReservedWord, TERMINATOR_WORDS } from "./reserved.ts";
import { ParseSession } from "./session.ts";
import type { SourceDocument, Span } from "./source.ts";
import { EMPTY_STOPS, type Stops } from "./stops.ts";
import { looksLikeFunctionDefinition, parseWord } from "./word-parser.ts";

/** Commands whose arguments may be array literals (`declare -a x=(1 2)`). */
const DECLARATION_COMMANDS: ReadonlySet<string> = new Set([
    "declare",
    "typeset",
    "local",
    "export",
    "readonly",
]);

export class Parser {
    readonly maxDepth: number;

    constructor(maxDepth = 200) {
        this.maxDepth = maxDepth;
    }

    parse(doc: SourceDocument): ParseResult {
        const session = new ParseSession(doc, this.maxDepth, () =>
            readPendingHeredocs(session),
        );
        try {
            const raw = parseScript(session, EMPTY_STOPS);
            session.skipSeparators();
            if (!session.atEnd()) {
                session.error("unexpected trailing input");
            }
            readPendingHeredocs(session);
            const finals = session.heredocFinals();
            return { ok: true, script: resolveHeredocs(raw, finals) };
        } catch (error) {
            if (error instanceof ParseAbort) {
                return { ok: false, error: error.parseError };
            }
            const message = error instanceof Error ? error.message : String(error);
            return {
                ok: false,
                error: {
                    message: `internal parser error: ${message}`,
                    span: {
                        start: session.pos,
                        end: Math.min(session.pos + 1, doc.text.length),
                    },
                },
            };
        }
    }
}

export function parseScript(session: ParseSession, stop: Stops): Script {
    session.pushCommentScope();
    const body = parseCommandList(session, stop);
    const comments = session.popCommentScope();
    return { kind: "Script", body, comments, span: body.span };
}

function atCaseTerminator(session: ParseSession): boolean {
    return session.match(";;") || session.match(";&");
}

function isStop(session: ParseSession, stop: Stops): boolean {
    if (session.atEnd()) {
        return true;
    }
    if (stop.closeParen && session.peek() === ")") {
        return true;
    }
    if (stop.caseTerminator && atCaseTerminator(session)) {
        return true;
    }
    if (stop.closeBracket && session.match("]]") && isTokenBoundary(session, 2)) {
        return true;
    }
    if (session.inBacktick() && session.peek() === "`") {
        return true;
    }
    const reserved = peekReservedWord(session);
    return reserved !== undefined && stop.words.includes(reserved);
}

export function parseCommandList(session: ParseSession, stop: Stops): CommandList {
    const items: CommandListItem[] = [];
    session.skipSeparators();
    const start = session.pos;
    while (!session.atEnd() && !isStop(session, stop)) {
        const before = session.pos;
        const command = parseAndOr(session);
        if (session.pos === before) {
            session.error("parser made no progress");
        }
        session.skipBlanks();
        let separator: Separator | undefined;
        if (session.atEnd()) {
            separator = undefined;
        } else if (session.peek() === "\n") {
            session.consumeNewline();
            separator = "\n";
        } else if (session.peek() === ";") {
            if (stop.caseTerminator && atCaseTerminator(session)) {
                separator = undefined;
            } else {
                session.advance(1);
                separator = ";";
            }
        } else if (session.peek() === "&") {
            if (session.match("&&")) {
                session.error("unexpected '&&'");
            }
            session.advance(1);
            separator = "&";
        } else if (session.peek() === "#") {
            session.consumeComment();
            if (session.peek() === "\n") {
                session.consumeNewline();
            }
            separator = "\n";
        } else if (isStop(session, stop)) {
            separator = undefined;
        } else {
            session.error(`unexpected token '${session.peek()}'`);
        }
        items.push({ kind: "CommandListItem", command, separator, span: command.span });
        if (separator === undefined) {
            break;
        }
        session.skipSeparators();
    }
    const last = items[items.length - 1];
    const span: Span = last !== undefined ? last.command.span : { start, end: start };
    return { kind: "CommandList", items, span };
}

export function parseAndOr(session: ParseSession): AndOr {
    const first = parsePipeline(session);
    const rest: AndOrLink[] = [];
    let end = first.span.end;
    for (;;) {
        session.skipBlanks();
        let operator: "&&" | "||";
        if (session.match("&&")) {
            operator = "&&";
        } else if (session.match("||")) {
            operator = "||";
        } else {
            break;
        }
        session.advance(2);
        session.skipSeparators();
        const pipeline = parsePipeline(session);
        end = pipeline.span.end;
        rest.push({
            kind: "AndOrLink",
            operator,
            pipeline,
            span: { start: first.span.start, end },
        });
    }
    return { kind: "AndOr", first, rest, span: { start: first.span.start, end } };
}

/** Whether the cursor can begin a command (used for `time`/`!` with no body). */
function canStartCommand(session: ParseSession): boolean {
    const c = session.peek();
    return (
        c !== "" &&
        c !== "\n" &&
        c !== ";" &&
        c !== "&" &&
        c !== "|" &&
        c !== ")" &&
        c !== "#"
    );
}

export function parsePipeline(session: ParseSession): Pipeline {
    const start = session.pos;
    let negated = false;
    let time: TimeKeyword | undefined;
    for (;;) {
        session.skipBlanks();
        const reserved = peekReservedWord(session);
        if (reserved === "!") {
            session.advance(1);
            negated = true;
            continue;
        }
        if (reserved === "time" && time === undefined) {
            const timeStart = session.pos;
            session.advance(4);
            let posix = false;
            session.skipBlanks();
            if (session.match("-p") && isTokenBoundary(session, 2)) {
                session.advance(2);
                posix = true;
            }
            time = {
                kind: "TimeKeyword",
                posix,
                span: session.span(timeStart, session.pos),
            };
            continue;
        }
        break;
    }
    const flagEnd = session.pos;
    const members: PipelineMember[] = [];
    for (;;) {
        session.skipBlanks();
        if ((negated || time !== undefined) && !canStartCommand(session)) {
            break;
        }
        const command = parseCommand(session);
        session.skipBlanks();
        let pipe: "|" | "|&" | undefined;
        if (session.match("|&")) {
            pipe = "|&";
            session.advance(2);
        } else if (session.peek() === "|" && !session.match("||")) {
            pipe = "|";
            session.advance(1);
        }
        members.push({ kind: "PipelineMember", command, pipe, span: command.span });
        if (pipe === undefined) {
            break;
        }
        session.skipSeparators();
    }
    const last = members[members.length - 1];
    const end = last !== undefined ? last.command.span.end : flagEnd;
    return { kind: "Pipeline", negated, time, members, span: { start, end } };
}

export function parseCommand(session: ParseSession): Command {
    session.enter();
    try {
        return parseCommandInner(session);
    } finally {
        session.leave();
    }
}

function parseCommandInner(session: ParseSession): Command {
    session.skipBlanks();
    const c = session.peek();
    if (c === "") {
        session.error("expected a command");
    }
    if (c === "(") {
        if (session.peek(1) === "(") {
            return parseArithmeticCommand(session);
        }
        return parseSubshell(session);
    }
    if (session.match("[[") && peekReservedWord(session) === "[[") {
        return parseTestCommand(session);
    }
    const reserved = peekReservedWord(session);
    switch (reserved) {
        case "{":
            return parseBraceGroup(session);
        case "if":
            return parseIf(session);
        case "while":
            return parseLoop(session, "While");
        case "until":
            return parseLoop(session, "Until");
        case "for":
            return parseFor(session);
        case "select":
            return parseSelect(session);
        case "case":
            return parseCase(session);
        case "function":
            return parseFunctionDefinition(session, true);
        case "coproc":
            return parseCoproc(session);
        default:
            break;
    }
    if (reserved !== undefined && TERMINATOR_WORDS.has(reserved)) {
        session.error(`unexpected reserved word '${reserved}'`);
    }
    if (looksLikeFunctionDefinition(session)) {
        return parseFunctionDefinition(session, false);
    }
    return parseSimpleCommand(session);
}

function isDeclarationCommand(words: readonly Word[]): boolean {
    const first = words[0];
    return (
        first !== undefined &&
        first.value !== undefined &&
        DECLARATION_COMMANDS.has(first.value)
    );
}

export function parseSimpleCommand(session: ParseSession): SimpleCommand {
    const start = session.pos;
    const elements: (Assignment | Word | Redirect)[] = [];
    const words: Word[] = [];
    const assignments: Assignment[] = [];
    const redirects: Redirect[] = [];
    let seenWord = false;
    for (;;) {
        session.skipBlanks();
        if (session.atEnd()) {
            break;
        }
        const c = session.peek();
        const redirect = tryParseRedirect(session);
        if (redirect !== undefined) {
            redirects.push(redirect);
            elements.push(redirect);
            continue;
        }
        if (
            c === "\n" ||
            c === ";" ||
            c === "&" ||
            c === "|" ||
            c === ")" ||
            c === "#"
        ) {
            break;
        }
        if (!seenWord) {
            const assignment = tryParseAssignment(session);
            if (assignment !== undefined) {
                assignments.push(assignment);
                elements.push(assignment);
                continue;
            }
        } else if (isNameStart(c) && isDeclarationCommand(words)) {
            const saved = session.pos;
            const assignment = tryParseAssignment(session);
            if (assignment !== undefined && assignment.value.kind === "ArrayValue") {
                elements.push(assignment);
                continue;
            }
            session.pos = saved;
        }
        const word = parseWord(session, {});
        if (word === undefined) {
            break;
        }
        words.push(word);
        elements.push(word);
        seenWord = true;
    }
    if (elements.length === 0) {
        session.error("expected a command");
    }
    let end = start;
    for (const element of elements) {
        end = element.span.end;
    }
    return {
        kind: "SimpleCommand",
        elements,
        words,
        assignments,
        redirects,
        span: session.span(start, end),
    };
}
