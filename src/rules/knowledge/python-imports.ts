/* eslint-disable sonarjs/function-return-type */
/**
 * Reading the imports of a piece of Python code well enough to know which
 * third-party distributions it needs — without a Python parser.
 *
 * The scanner is deliberately line-based and forgiving: it recognizes the
 * static import forms an agent writes in a one-liner or a probe script
 * (`import a.b as c`, `from a import (x, y)`, `__import__("a")`,
 * `importlib.import_module("a.b")`), skips `#` comments and string or
 * triple-quoted blocks, splits `;`-joined statements, and never throws.
 * Anything it cannot read is simply not reported.
 */
import { PYTHON_DISTRIBUTIONS } from "./data/python-distributions.ts";
import { PYTHON_STDLIB_MODULE_NAMES } from "./data/python-stdlib.ts";

type Token =
    | { readonly kind: "name"; readonly value: string }
    | { readonly kind: "string"; readonly value: string }
    | { readonly kind: "dot" }
    | { readonly kind: "comma" }
    | { readonly kind: "colon" }
    | { readonly kind: "lparen" }
    | { readonly kind: "rparen" }
    | { readonly kind: "separator" };

const PUNCTUATION: Readonly<Record<string, Token>> = Object.freeze({
    ".": { kind: "dot" },
    ",": { kind: "comma" },
    ":": { kind: "colon" },
    "(": { kind: "lparen" },
    ")": { kind: "rparen" },
});

/**
 * The top-level module names imported by a piece of Python code, in first-seen
 * order and deduplicated. Stdlib filtering and distribution mapping are the
 * caller's job (see {@link isStdlibModule}, {@link distributionFor}).
 */
export class PythonImportScanner {
    scan(code: string): readonly string[] {
        const modules: string[] = [];
        const seen = new Set<string>();
        const record = (name: string): void => {
            const top = topLevelModule(name);
            if (top !== undefined && !seen.has(top)) {
                seen.add(top);
                modules.push(top);
            }
        };
        for (const statement of splitStatements(tokenize(code))) {
            scanStatement(statement, record);
        }
        return modules;
    }
}

/** Whether `name` belongs to the standard library (private `_x` included). */
export function isStdlibModule(name: string): boolean {
    return name.startsWith("_") || STDLIB.has(name);
}

/**
 * The PyPI distribution providing `module`, or `undefined` when it is not in
 * the curated allow-list. Guessing the import name as the distribution is
 * deliberately avoided: an unknown import gets no dependency at all rather
 * than a wrong one.
 */
export function distributionFor(module: string): string | undefined {
    return PYTHON_DISTRIBUTIONS[module];
}

/** Whether `text` is a PEP 723 script (a `# /// script` block). */
export function hasPep723Block(text: string): boolean {
    return /^#\s*\/\/\/\s*script\b/m.test(text);
}

const STDLIB: ReadonlySet<string> = new Set(PYTHON_STDLIB_MODULE_NAMES);

// --- tokenizer --------------------------------------------------------------

function tokenize(code: string): Token[] {
    const tokens: Token[] = [];
    let index = 0;
    while (index < code.length) {
        const char = code[index] ?? "";
        if (char === "\n" || char === ";") {
            tokens.push({ kind: "separator" });
            index += 1;
            continue;
        }
        if (char === "#") {
            index = skipLine(code, index);
            continue;
        }
        if (char === "'" || char === '"') {
            const string = readString(code, index);
            tokens.push({ kind: "string", value: string.value });
            index = string.end;
            continue;
        }
        if (IDENTIFIER_START.test(char)) {
            const end = readIdentifier(code, index);
            tokens.push({ kind: "name", value: code.slice(index, end) });
            index = end;
            continue;
        }
        const punctuation = PUNCTUATION[char];
        if (punctuation !== undefined) {
            tokens.push(punctuation);
        }
        index += 1;
    }
    return tokens;
}

const IDENTIFIER_START = /[A-Za-z_]/;
const IDENTIFIER_PART = /\w/;

function readIdentifier(code: string, start: number): number {
    let index = start;
    while (index < code.length && IDENTIFIER_PART.test(code[index] ?? "")) {
        index += 1;
    }
    return index;
}

function skipLine(code: string, start: number): number {
    let index = start;
    while (index < code.length && code[index] !== "\n") {
        index += 1;
    }
    return index;
}

/** Reads a quoted string (single, triple, escaped), stopping at end of line. */
function readString(code: string, start: number): { value: string; end: number } {
    const quote = code[start] ?? "";
    const triple = code.startsWith(quote.repeat(3), start);
    const width = triple ? 3 : 1;
    let index = start + width;
    let value = "";
    while (index < code.length) {
        const char = code[index] ?? "";
        if (char === "\\") {
            value += char + (code[index + 1] ?? "");
            index += 2;
            continue;
        }
        if (code.startsWith(quote.repeat(width), index)) {
            return { value, end: index + width };
        }
        if (!triple && char === "\n") {
            return { value, end: index };
        }
        value += char;
        index += 1;
    }
    return { value, end: code.length };
}

// --- statement parsing ------------------------------------------------------

function splitStatements(tokens: readonly Token[]): Token[][] {
    const statements: Token[][] = [];
    let current: Token[] = [];
    let depth = 0;
    for (const token of tokens) {
        if (token.kind === "lparen") {
            depth += 1;
        } else if (token.kind === "rparen" && depth > 0) {
            depth -= 1;
        }
        if (token.kind === "separator" && depth === 0) {
            statements.push(current);
            current = [];
            continue;
        }
        current.push(token);
    }
    statements.push(current);
    return statements;
}

type ImportSink = (name: string) => void;

function scanStatement(tokens: readonly Token[], record: ImportSink): void {
    let index = 0;
    while (index < tokens.length) {
        const token = tokens[index];
        if (token?.kind === "name" && token.value === "from") {
            index = scanFrom(tokens, index, record);
            continue;
        }
        if (
            token?.kind === "name" &&
            token.value === "import" &&
            (index === 0 || tokens[index - 1]?.kind === "colon")
        ) {
            index = scanImport(tokens, index, record);
            continue;
        }
        index += 1;
    }
    scanDynamic(tokens, record);
}

/** `from a.b import …` → `a`; any relative import (`from . import x`) is local. */
function scanFrom(tokens: readonly Token[], start: number, record: ImportSink): number {
    let index = start + 1;
    let relative = false;
    while (tokens[index]?.kind === "dot") {
        relative = true;
        index += 1;
    }
    if (!relative) {
        const dotted = readDottedName(tokens, index);
        if (dotted.names.length > 0) {
            record(dotted.names.join("."));
        }
    }
    return tokens.length;
}

/** `import a.b as c, d` → `a`, `d`. */
function scanImport(
    tokens: readonly Token[],
    start: number,
    record: ImportSink,
): number {
    let index = start + 1;
    for (;;) {
        const module = tokens[index];
        if (module?.kind !== "name") {
            return index;
        }
        const dotted = readDottedName(tokens, index);
        record(dotted.names.join("."));
        index = dotted.end;
        const alias = tokens[index];
        if (alias?.kind === "name" && alias.value === "as") {
            index += 2;
        }
        if (tokens[index]?.kind === "comma") {
            index += 1;
            continue;
        }
        return index;
    }
}

/** Dotted name at `start`: `["a","b"]` and the index just past it. */
function readDottedName(
    tokens: readonly Token[],
    start: number,
): { names: string[]; end: number } {
    const names: string[] = [];
    const first = tokens[start];
    if (first?.kind !== "name") {
        return { names, end: start };
    }
    names.push(first.value);
    let index = start + 1;
    while (tokens[index]?.kind === "dot" && tokens[index + 1]?.kind === "name") {
        names.push(nameValue(tokens[index + 1]));
        index += 2;
    }
    return { names, end: index };
}

function nameValue(token: Token | undefined): string {
    return token?.kind === "name" ? token.value : "";
}

/** `__import__("a")` and `importlib.import_module("a.b")` anywhere. */
function scanDynamic(tokens: readonly Token[], record: ImportSink): void {
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (token?.kind !== "name") {
            continue;
        }
        if (token.value === "__import__") {
            const argument = stringCall(tokens, index);
            if (argument !== undefined) {
                record(argument);
            }
            continue;
        }
        if (
            token.value === "importlib" &&
            tokens[index + 1]?.kind === "dot" &&
            nameValue(tokens[index + 2]) === "import_module"
        ) {
            const argument = stringCall(tokens, index + 2);
            if (argument !== undefined) {
                record(argument);
            }
        }
    }
}

/** The literal first argument of a call `name("…")`, when it is a string. */
function stringCall(tokens: readonly Token[], nameIndex: number): string | undefined {
    if (tokens[nameIndex + 1]?.kind !== "lparen") {
        return undefined;
    }
    const argument = tokens[nameIndex + 2];
    return argument?.kind === "string" ? argument.value : undefined;
}

function topLevelModule(name: string): string | undefined {
    const top = name.split(".")[0]?.trim();
    return top === undefined || top === "" ? undefined : top;
}
