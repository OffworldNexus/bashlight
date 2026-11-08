// Recursive-descent parsing mirrors a branchy grammar and returns optional nodes.
/* eslint-disable sonarjs/cognitive-complexity, sonarjs/function-return-type */
/**
 * Expansions: `$x`, `${…}`, `$(…)`, `` `…` ``, `$((…))`, `$[…]`, `$'…'`, `$"…"`
 * and `<(…)`/`>(…)`. All of them return word parts; recursive command
 * substitutions call back into the script parser.
 */

import type {
    AnsiCQuotedPart,
    ArithmeticExpansionPart,
    CommandSubstitutionPart,
    ParameterExpansionPart,
    ProcessSubstitutionPart,
    WordPart,
} from "./ast.ts";
import { isDigit, isNameChar, isNameStart } from "./chars.ts";
import { parseParameterExpansion } from "./parameter-expansion.ts";
import { parseScript } from "./parser.ts";
import { parseDoubleQuotedPart } from "./quoted-body.ts";
import { scanDelimited } from "./scan.ts";
import type { ParseSession } from "./session.ts";
import type { Span } from "./source.ts";
import { PAREN_STOPS } from "./stops.ts";

interface ExpansionOptions {
    readonly inDoubleQuotes?: boolean;
}

export function parseDollar(
    session: ParseSession,
    options: ExpansionOptions,
): WordPart {
    const start = session.pos;
    session.advance(1);
    const c = session.peek();
    if (c === "(") {
        if (session.peek(1) === "(") {
            return parseArithmeticParen(session, start);
        }
        session.advance(1);
        const script = parseScript(session, PAREN_STOPS);
        if (session.peek() !== ")") {
            session.error("expected ')' to close command substitution");
        }
        session.advance(1);
        return {
            kind: "CommandSubstitution",
            script,
            style: "dollar",
            span: session.span(start, session.pos),
        };
    }
    if (c === "{") {
        return parseParameterExpansion(session, start);
    }
    if (c === "'" && options.inDoubleQuotes !== true) {
        return parseAnsiCQuoted(session, start);
    }
    if (c === '"' && options.inDoubleQuotes !== true) {
        return parseDoubleQuotedPart(session, "LocaleQuoted", start);
    }
    if (c === "[") {
        return parseArithmeticBracket(session, start);
    }
    if (isSpecialParameter(c)) {
        session.advance(1);
        return simpleParameter(c, session.span(start, session.pos));
    }
    if (isNameStart(c)) {
        const nameStart = session.pos;
        while (isNameChar(session.peek())) {
            session.advance(1);
        }
        const name = session.slice(nameStart, session.pos);
        return simpleParameter(name, session.span(start, session.pos));
    }
    return {
        kind: "Literal",
        value: "$",
        hasGlob: false,
        span: session.span(start, session.pos),
    };
}

function isSpecialParameter(c: string): boolean {
    return (
        c === "@" ||
        c === "*" ||
        c === "#" ||
        c === "?" ||
        c === "$" ||
        c === "!" ||
        c === "-" ||
        isDigit(c)
    );
}

function simpleParameter(name: string, span: Span): ParameterExpansionPart {
    return {
        kind: "ParameterExpansion",
        name,
        simple: true,
        index: undefined,
        operator: undefined,
        argument: undefined,
        length: false,
        indirect: false,
        span,
    };
}

function parseArithmeticParen(
    session: ParseSession,
    start: number,
): ArithmeticExpansionPart {
    session.advance(2);
    const exprStart = session.pos;
    const scan = scanDelimited(session.text, exprStart, "(", ")", true);
    if (!scan.terminated) {
        session.error(
            "unterminated arithmetic expansion",
            session.span(start, session.pos),
        );
    }
    const expression = session.slice(exprStart, scan.end - 2);
    session.pos = scan.end;
    return {
        kind: "ArithmeticExpansion",
        expression,
        span: session.span(start, session.pos),
    };
}

function parseArithmeticBracket(
    session: ParseSession,
    start: number,
): ArithmeticExpansionPart {
    session.advance(1);
    const exprStart = session.pos;
    const scan = scanDelimited(session.text, exprStart, "[", "]", false);
    if (!scan.terminated) {
        session.error(
            "unterminated arithmetic expansion",
            session.span(start, session.pos),
        );
    }
    const expression = session.slice(exprStart, scan.end - 1);
    session.pos = scan.end;
    return {
        kind: "ArithmeticExpansion",
        expression,
        span: session.span(start, session.pos),
    };
}

function parseAnsiCQuoted(session: ParseSession, start: number): AnsiCQuotedPart {
    session.advance(1);
    const contentStart = session.pos;
    while (!session.atEnd() && session.peek() !== "'") {
        if (session.peek() === "\\") {
            session.advance(2);
            continue;
        }
        session.advance(1);
    }
    if (session.atEnd()) {
        session.error("unterminated $'…'");
    }
    const raw = session.slice(contentStart, session.pos);
    session.advance(1);
    return {
        kind: "AnsiCQuoted",
        value: decodeAnsiC(raw),
        span: session.span(start, session.pos),
    };
}

export function parseBacktickPart(session: ParseSession): CommandSubstitutionPart {
    const start = session.pos;
    session.advance(1);
    session.enterBacktick();
    const script = parseScript(session, PAREN_STOPS);
    if (session.peek() !== "`") {
        session.error("unterminated backtick substitution");
    }
    session.advance(1);
    session.leaveBacktick();
    return {
        kind: "CommandSubstitution",
        script,
        style: "backtick",
        span: session.span(start, session.pos),
    };
}

export function parseProcessSubstitutionPart(
    session: ParseSession,
): ProcessSubstitutionPart {
    const start = session.pos;
    const direction = session.peek() === "<" ? "<" : ">";
    session.advance(2);
    const script = parseScript(session, PAREN_STOPS);
    if (session.peek() !== ")") {
        session.error("expected ')' to close process substitution");
    }
    session.advance(1);
    return {
        kind: "ProcessSubstitution",
        direction,
        script,
        span: session.span(start, session.pos),
    };
}

/**
 * Decodes the escapes of `$'…'`, following bash: `\cX` is a control character,
 * `\xHH`/`\uHHHH`/`\UHHHHHHHH` keep the backslash when no hex digit follows, and
 * `\NNN` is a **byte** (`& 0xff`), not a code point. An out-of-range `\U…`
 * (> U+10FFFF) is kept literal rather than throwing.
 */
export function decodeAnsiC(raw: string): string {
    let out = "";
    let i = 0;
    while (i < raw.length) {
        const c = raw[i];
        if (c !== "\\") {
            out += c;
            i += 1;
            continue;
        }
        const n = raw[i + 1];
        if (n === undefined) {
            out += "\\";
            i += 1;
            continue;
        }
        switch (n) {
            case "a":
                out += "\x07";
                i += 2;
                break;
            case "b":
                out += "\b";
                i += 2;
                break;
            case "e":
            case "E":
                out += "\x1b";
                i += 2;
                break;
            case "f":
                out += "\f";
                i += 2;
                break;
            case "n":
                out += "\n";
                i += 2;
                break;
            case "r":
                out += "\r";
                i += 2;
                break;
            case "t":
                out += "\t";
                i += 2;
                break;
            case "v":
                out += "\v";
                i += 2;
                break;
            case "\\":
                out += "\\";
                i += 2;
                break;
            case "'":
                out += "'";
                i += 2;
                break;
            case '"':
                out += '"';
                i += 2;
                break;
            case "?":
                out += "?";
                i += 2;
                break;
            case "c": {
                const x = raw[i + 2];
                if (x === undefined) {
                    out += "\\c";
                    i += 2;
                    break;
                }
                const code = x.toUpperCase().charCodeAt(0);
                out += String.fromCharCode(code === 0x3f ? 0x7f : code & 0x1f);
                i += 3;
                break;
            }
            case "x": {
                const m = /^[0-9a-fA-F]{1,2}/.exec(raw.slice(i + 2));
                if (m === null) {
                    out += "\\x";
                    i += 2;
                    break;
                }
                out += String.fromCharCode(Number.parseInt(m[0], 16));
                i += 2 + m[0].length;
                break;
            }
            case "u":
            case "U": {
                const max = n === "u" ? 4 : 8;
                const m = new RegExp(`^[0-9a-fA-F]{1,${max}}`).exec(raw.slice(i + 2));
                if (m === null) {
                    out += "\\" + n;
                    i += 2;
                    break;
                }
                const codePoint = Number.parseInt(m[0], 16);
                if (codePoint > 0x10ffff) {
                    out += "\\" + n + m[0];
                    i += 2 + m[0].length;
                    break;
                }
                out += String.fromCodePoint(codePoint);
                i += 2 + m[0].length;
                break;
            }
            default: {
                if (n >= "0" && n <= "7") {
                    const m = /^[0-7]{1,3}/.exec(raw.slice(i + 1));
                    if (m !== null) {
                        out += String.fromCharCode(Number.parseInt(m[0], 8) & 0xff);
                        i += 1 + m[0].length;
                        break;
                    }
                }
                out += "\\" + n;
                i += 2;
                break;
            }
        }
    }
    return out;
}
