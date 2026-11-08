// Recursive-descent parsing mirrors a branchy grammar and returns optional nodes.
/* eslint-disable sonarjs/cognitive-complexity, sonarjs/function-return-type */
/**
 * Compound commands: subshells, brace groups, `if`, loops, function
 * definitions, arithmetic commands, `[[ … ]]` and `coproc`. `for`, `select`
 * and `case` live in `loop-case-parser.ts`. Each compound consumes its own
 * trailing redirections so `{ …; } > out` and `while …; done < f` work.
 */

import type {
    ArithmeticCommand,
    BraceGroup,
    Command,
    CommandList,
    Coproc,
    FunctionDefinition,
    If,
    IfClause,
    Subshell,
    TestCommand,
    TestOperator,
    TestOperatorKind,
    Until,
    While,
    Word,
} from "./ast.ts";
import { readName } from "./chars.ts";
import { parseCommand, parseScript } from "./parser.ts";
import { parseTrailingRedirects } from "./redirect-parser.ts";
import { COMPOUND_STARTS, isTokenBoundary, peekReservedWord } from "./reserved.ts";
import { scanDelimited } from "./scan.ts";
import type { ParseSession } from "./session.ts";
import { stops } from "./stops.ts";
import { parseWord, scanNameToken } from "./word-parser.ts";

export function parseSubshell(session: ParseSession): Subshell {
    const start = session.pos;
    session.advance(1);
    const body = parseScript(session, stops({ closeParen: true })).body;
    if (session.peek() !== ")") {
        session.error(
            "expected ')' to close a subshell",
            session.span(start, session.pos),
        );
    }
    session.advance(1);
    const redirects = parseTrailingRedirects(session);
    return {
        kind: "Subshell",
        body,
        redirects,
        span: session.span(start, session.pos),
    };
}

export function parseBraceGroup(session: ParseSession): BraceGroup {
    const start = session.pos;
    session.advance(1);
    const body = parseScript(session, stops({ words: ["}"] })).body;
    if (body.items.length === 0) {
        session.error(
            "expected a command inside '{ …; }'",
            session.span(start, session.pos),
        );
    }
    if (peekReservedWord(session) !== "}") {
        session.error("expected '}'", session.span(start, session.pos));
    }
    session.advance(1);
    const redirects = parseTrailingRedirects(session);
    return {
        kind: "BraceGroup",
        body,
        redirects,
        span: session.span(start, session.pos),
    };
}

export function parseIf(session: ParseSession): If {
    const start = session.pos;
    session.advance(2);
    const clauses: IfClause[] = [];
    let elseBody: CommandList | undefined;
    for (;;) {
        const clauseStart = session.pos;
        const condition = parseScript(session, stops({ words: ["then"] })).body;
        session.skipBlanks();
        if (peekReservedWord(session) !== "then") {
            session.error("expected 'then'", session.span(start, session.pos));
        }
        session.advance(4);
        const body = parseScript(
            session,
            stops({ words: ["elif", "else", "fi"] }),
        ).body;
        clauses.push({
            kind: "IfClause",
            condition,
            body,
            span: session.span(clauseStart, body.span.end),
        });
        session.skipBlanks();
        const reserved = peekReservedWord(session);
        if (reserved === "elif") {
            session.advance(4);
            continue;
        }
        if (reserved === "else") {
            session.advance(4);
            elseBody = parseScript(session, stops({ words: ["fi"] })).body;
            session.skipBlanks();
        }
        break;
    }
    if (peekReservedWord(session) !== "fi") {
        session.error("expected 'fi'", session.span(start, session.pos));
    }
    session.advance(2);
    const redirects = parseTrailingRedirects(session);
    return {
        kind: "If",
        clauses,
        elseBody,
        redirects,
        span: session.span(start, session.pos),
    };
}

/** `while` and `until` share everything but the node kind. */
export function parseLoop(
    session: ParseSession,
    kind: "While" | "Until",
): While | Until {
    const start = session.pos;
    session.advance(5);
    const condition = parseScript(session, stops({ words: ["do"] })).body;
    session.skipBlanks();
    if (peekReservedWord(session) !== "do") {
        session.error("expected 'do'", session.span(start, session.pos));
    }
    session.advance(2);
    const body = parseScript(session, stops({ words: ["done"] })).body;
    session.skipBlanks();
    if (peekReservedWord(session) !== "done") {
        session.error("expected 'done'", session.span(start, session.pos));
    }
    session.advance(4);
    const redirects = parseTrailingRedirects(session);
    const common = {
        condition,
        body,
        redirects,
        span: session.span(start, session.pos),
    };
    return kind === "Until"
        ? { kind: "Until", ...common }
        : { kind: "While", ...common };
}

export function parseFunctionDefinition(
    session: ParseSession,
    functionKeyword: boolean,
): FunctionDefinition {
    const start = session.pos;
    if (functionKeyword) {
        session.advance(8);
    }
    session.skipBlanks();
    const nameToken = scanNameToken(session);
    if (nameToken === undefined) {
        session.error("expected a function name", session.span(start, session.pos));
    }
    const name = nameToken.name;
    const nameSpan = nameToken.span;
    session.skipBlanks();
    if (session.peek() === "(") {
        session.advance(1);
        session.skipBlanks();
        if (session.peek() !== ")") {
            session.error(
                "expected '()' after the function name",
                session.span(start, session.pos),
            );
        }
        session.advance(1);
    }
    session.skipSeparators();
    const body = parseCommand(session);
    if (body.kind === "SimpleCommand") {
        session.error("expected a compound command as the function body", body.span);
    }
    return {
        kind: "FunctionDefinition",
        name,
        nameSpan,
        functionKeyword,
        body,
        span: session.span(start, session.pos),
    };
}

export function parseArithmeticCommand(session: ParseSession): ArithmeticCommand {
    const start = session.pos;
    session.advance(2);
    const exprStart = session.pos;
    const scan = scanDelimited(session.text, exprStart, "(", ")", true);
    if (!scan.terminated) {
        session.error(
            "unterminated arithmetic command",
            session.span(start, session.pos),
        );
    }
    const expression = session.slice(exprStart, scan.end - 2);
    session.pos = scan.end;
    const redirects = parseTrailingRedirects(session);
    return {
        kind: "ArithmeticCommand",
        expression,
        redirects,
        span: session.span(start, session.pos),
    };
}

export function parseTestCommand(session: ParseSession): TestCommand {
    const start = session.pos;
    session.advance(2);
    const elements: (Word | TestOperator)[] = [];
    const words: Word[] = [];
    for (;;) {
        session.skipBlanks();
        if (session.peek() === "\n") {
            session.consumeNewline();
            continue;
        }
        if (session.peek() === "#") {
            session.consumeComment();
            continue;
        }
        if (session.match("]]") && isTokenBoundary(session, 2)) {
            session.advance(2);
            break;
        }
        if (session.atEnd()) {
            session.error("expected ']]'", session.span(start, session.pos));
        }
        const operator = parseTestOperatorToken(session);
        if (operator !== undefined) {
            elements.push(operator);
            continue;
        }
        const word = parseWord(session, { test: true });
        if (word === undefined) {
            session.error("unexpected token in '[[ … ]]'");
        }
        elements.push(word);
        words.push(word);
    }
    const redirects = parseTrailingRedirects(session);
    return {
        kind: "TestCommand",
        elements,
        words,
        redirects,
        span: session.span(start, session.pos),
    };
}

function parseTestOperatorToken(session: ParseSession): TestOperator | undefined {
    const start = session.pos;
    const c = session.peek();
    const make = (operator: TestOperatorKind): TestOperator => ({
        kind: "TestOperator",
        operator,
        span: session.span(start, session.pos),
    });
    if (c === "(" || c === ")") {
        session.advance(1);
        return make(c);
    }
    if (c === "&") {
        if (session.match("&&")) {
            session.advance(2);
            return make("&&");
        }
        return undefined;
    }
    if (c === "|") {
        if (session.match("||")) {
            session.advance(2);
            return make("||");
        }
        return undefined;
    }
    if (c === "!") {
        if (session.peek(1) === "=") {
            session.advance(2);
            return make("!=");
        }
        session.advance(1);
        return make("!");
    }
    if (c === "<") {
        session.advance(1);
        return make("<");
    }
    if (c === ">") {
        session.advance(1);
        return make(">");
    }
    if (c === "=") {
        if (session.peek(1) === "=") {
            session.advance(2);
            return make("==");
        }
        if (session.peek(1) === "~") {
            session.advance(2);
            return make("=~");
        }
        session.advance(1);
        return make("=");
    }
    return undefined;
}

export function parseCoproc(session: ParseSession): Coproc {
    const start = session.pos;
    session.advance(6);
    session.skipBlanks();
    if (startsCompound(session)) {
        const body = parseCommand(session);
        return {
            kind: "Coproc",
            name: undefined,
            nameSpan: undefined,
            body,
            span: session.span(start, session.pos),
        };
    }
    const saved = session.pos;
    const nameToken = readName(session);
    if (nameToken !== undefined) {
        session.skipBlanks();
        if (startsCompound(session)) {
            const body = parseCommand(session);
            return {
                kind: "Coproc",
                name: nameToken.name,
                nameSpan: nameToken.span,
                body,
                span: session.span(start, session.pos),
            };
        }
        session.pos = saved;
    }
    const body: Command = parseCommand(session);
    return {
        kind: "Coproc",
        name: undefined,
        nameSpan: undefined,
        body,
        span: session.span(start, session.pos),
    };
}

function startsCompound(session: ParseSession): boolean {
    if (session.peek() === "(") {
        return true;
    }
    const reserved = peekReservedWord(session);
    return reserved !== undefined && COMPOUND_STARTS.has(reserved);
}
