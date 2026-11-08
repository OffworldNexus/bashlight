/* eslint-disable sonarjs/cognitive-complexity, sonarjs/function-return-type */
/**
 * A tiny arithmetic evaluator for `$(( … ))`, `(( … ))` and `${x:o:l}` operands.
 * It understands integers, variable references, the usual binary/unary
 * operators and comparisons, and returns `undefined` as soon as it meets
 * something it cannot evaluate (an unknown variable, an unsupported operator).
 */

import type { VariableState } from "./context.ts";

export type LookupVariable = (name: string) => VariableState;

interface Token {
    readonly kind: "number" | "name" | "op";
    readonly text: string;
}

const OPERATORS: readonly string[] = [
    "<<",
    ">>",
    "<=",
    ">=",
    "==",
    "!=",
    "&&",
    "||",
    "+",
    "-",
    "*",
    "/",
    "%",
    "(",
    ")",
    "<",
    ">",
    "!",
    "~",
    "&",
    "|",
    "^",
];

function tokenize(source: string): Token[] | undefined {
    const tokens: Token[] = [];
    let i = 0;
    while (i < source.length) {
        const c = source[i] ?? "";
        if (c === " " || c === "\t" || c === "\n" || c === "\r") {
            i += 1;
            continue;
        }
        if (c >= "0" && c <= "9") {
            let text = "";
            while (i < source.length && /[0-9a-fA-FxX]/.test(source[i] ?? "")) {
                text += source[i];
                i += 1;
            }
            tokens.push({ kind: "number", text });
            continue;
        }
        if (c === "$") {
            i += 1;
            const braced = source[i] === "{";
            if (braced) {
                i += 1;
            }
            let name = "";
            while (i < source.length && /\w/.test(source[i] ?? "")) {
                name += source[i];
                i += 1;
            }
            if (braced && source[i] === "}") {
                i += 1;
            }
            if (name === "") {
                return undefined;
            }
            tokens.push({ kind: "name", text: name });
            continue;
        }
        if (/[A-Za-z_]/.test(c)) {
            let name = "";
            while (i < source.length && /\w/.test(source[i] ?? "")) {
                name += source[i];
                i += 1;
            }
            tokens.push({ kind: "name", text: name });
            continue;
        }
        const operator = OPERATORS.find((candidate) => source.startsWith(candidate, i));
        if (operator === undefined) {
            return undefined;
        }
        tokens.push({ kind: "op", text: operator });
        i += operator.length;
    }
    return tokens;
}

class ArithmeticParser {
    private index = 0;

    constructor(
        private readonly tokens: readonly Token[],
        private readonly lookup: LookupVariable,
    ) {}

    parse(): number | undefined {
        const value = this.logicalOr();
        return this.index === this.tokens.length ? value : undefined;
    }

    private peek(): Token | undefined {
        return this.tokens[this.index];
    }

    private eat(text: string): boolean {
        const token = this.peek();
        if (token !== undefined && token.kind === "op" && token.text === text) {
            this.index += 1;
            return true;
        }
        return false;
    }

    private logicalOr(): number | undefined {
        let left = this.logicalAnd();
        while (this.eat("||")) {
            const right = this.logicalAnd();
            left = combine(left, right, (a, b) => (a !== 0 || b !== 0 ? 1 : 0));
        }
        return left;
    }

    private logicalAnd(): number | undefined {
        let left = this.bitOr();
        while (this.eat("&&")) {
            const right = this.bitOr();
            left = combine(left, right, (a, b) => (a !== 0 && b !== 0 ? 1 : 0));
        }
        return left;
    }

    private bitOr(): number | undefined {
        let left = this.bitXor();
        while (this.eat("|") && this.tokens[this.index - 1]?.text === "|") {
            const right = this.bitXor();
            left = combine(left, right, (a, b) => a | b);
        }
        return left;
    }

    private bitXor(): number | undefined {
        let left = this.bitAnd();
        while (this.eat("^")) {
            const right = this.bitAnd();
            left = combine(left, right, (a, b) => a ^ b);
        }
        return left;
    }

    private bitAnd(): number | undefined {
        let left = this.shift();
        while (this.eat("&") && this.tokens[this.index - 1]?.text === "&") {
            const right = this.shift();
            left = combine(left, right, (a, b) => a & b);
        }
        return left;
    }

    private shift(): number | undefined {
        let left = this.relational();
        for (;;) {
            if (this.eat("<<")) {
                left = combine(left, this.relational(), (a, b) => a << b);
            } else if (this.eat(">>")) {
                left = combine(left, this.relational(), (a, b) => a >> b);
            } else {
                return left;
            }
        }
    }

    private relational(): number | undefined {
        let left = this.additive();
        for (;;) {
            if (this.eat("<=")) {
                left = combine(left, this.additive(), (a, b) => (a <= b ? 1 : 0));
            } else if (this.eat(">=")) {
                left = combine(left, this.additive(), (a, b) => (a >= b ? 1 : 0));
            } else if (this.eat("==")) {
                left = combine(left, this.additive(), (a, b) => (a === b ? 1 : 0));
            } else if (this.eat("!=")) {
                left = combine(left, this.additive(), (a, b) => (a !== b ? 1 : 0));
            } else if (this.eat("<")) {
                left = combine(left, this.additive(), (a, b) => (a < b ? 1 : 0));
            } else if (this.eat(">")) {
                left = combine(left, this.additive(), (a, b) => (a > b ? 1 : 0));
            } else {
                return left;
            }
        }
    }

    private additive(): number | undefined {
        let left = this.multiplicative();
        for (;;) {
            if (this.eat("+")) {
                left = combine(left, this.multiplicative(), (a, b) => a + b);
            } else if (this.eat("-")) {
                left = combine(left, this.multiplicative(), (a, b) => a - b);
            } else {
                return left;
            }
        }
    }

    private multiplicative(): number | undefined {
        let left = this.unary();
        for (;;) {
            if (this.eat("*")) {
                left = combine(left, this.unary(), (a, b) => a * b);
            } else if (this.eat("/")) {
                const right = this.unary();
                left = combine(left, right, (a, b) =>
                    b === 0 ? 0 : Math.trunc(a / b),
                );
            } else if (this.eat("%")) {
                const right = this.unary();
                left = combine(left, right, (a, b) => (b === 0 ? 0 : a % b));
            } else {
                return left;
            }
        }
    }

    private unary(): number | undefined {
        if (this.eat("-")) {
            const value = this.unary();
            return value === undefined ? undefined : -value;
        }
        if (this.eat("+")) {
            return this.unary();
        }
        if (this.eat("!")) {
            const value = this.unary();
            if (value === undefined) {
                return undefined;
            }
            return value === 0 ? 1 : 0;
        }
        if (this.eat("~")) {
            const value = this.unary();
            return value === undefined ? undefined : ~value;
        }
        return this.primary();
    }

    private primary(): number | undefined {
        if (this.eat("(")) {
            const value = this.logicalOr();
            if (!this.eat(")")) {
                return undefined;
            }
            return value;
        }
        const token = this.peek();
        if (token === undefined) {
            return undefined;
        }
        this.index += 1;
        if (token.kind === "number") {
            return parseNumber(token.text);
        }
        if (token.kind === "name") {
            const state = this.lookup(token.text);
            if (state.kind !== "set") {
                return undefined;
            }
            return parseNumber(state.value);
        }
        return undefined;
    }
}

function combine(
    left: number | undefined,
    right: number | undefined,
    operation: (a: number, b: number) => number,
): number | undefined {
    if (left === undefined || right === undefined) {
        return undefined;
    }
    return operation(left, right);
}

function parseNumber(text: string): number | undefined {
    const trimmed = text.trim();
    if (/^[+-]?0[xX][0-9a-fA-F]+$/.test(trimmed)) {
        return Number.parseInt(trimmed.replace(/^[+-]?0[xX]/, ""), 16);
    }
    if (!/^[+-]?\d+$/.test(trimmed)) {
        return undefined;
    }
    return Number.parseInt(trimmed, 10);
}

/** Evaluates an arithmetic expression, or `undefined` when it is unknown. */
export function evaluateArithmetic(
    expression: string,
    lookup: LookupVariable,
): number | undefined {
    const tokens = tokenize(expression);
    if (tokens === undefined) {
        return undefined;
    }
    return new ArithmeticParser(tokens, lookup).parse();
}
