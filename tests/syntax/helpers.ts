// The span checker walks the AST and is inherently branchy.
/* eslint-disable sonarjs/cognitive-complexity */
/**
 * Shared test helpers: parse a snippet, walk the AST, and assert the span
 * round-trip invariants hold for every node.
 */

import { expect } from "bun:test";

import type {
    Command,
    Node,
    Script,
    SimpleCommand,
    Word,
} from "../../src/syntax/ast.ts";
import { Parser } from "../../src/syntax/parser.ts";
import {
    createSourceDocument,
    type SourceDocument,
    type Span,
} from "../../src/syntax/source.ts";

export const parser = new Parser();

export function parseOk(text: string): Script {
    const result = parser.parse(createSourceDocument(text));
    if (!result.ok) {
        throw new Error(
            `expected a successful parse of ${JSON.stringify(text)}: ${result.error.message}`,
        );
    }
    return result.script;
}

export function parseDoc(text: string): { doc: SourceDocument; script: Script } {
    const doc = createSourceDocument(text);
    const result = parser.parse(doc);
    if (!result.ok) {
        throw new Error(
            `expected a successful parse of ${JSON.stringify(text)}: ${result.error.message}`,
        );
    }
    return { doc, script: result.script };
}

function isSpan(value: unknown): value is Span {
    if (value === null || typeof value !== "object") {
        return false;
    }
    const record = value as Record<string, unknown>;
    return typeof record.start === "number" && typeof record.end === "number";
}

/** Finds every object that looks like a node (`kind` + `span`). */
export function walkNodes(root: unknown, visit: (node: Node) => void): void {
    const seen = new Set<object>();
    const stack: unknown[] = [root];
    while (stack.length > 0) {
        const value = stack.pop();
        if (value === null || typeof value !== "object" || seen.has(value)) {
            continue;
        }
        seen.add(value);
        const record = value as Record<string, unknown>;
        if (typeof record.kind === "string" && isSpan(record.span)) {
            visit(value as Node);
        }
        for (const key of Object.keys(record)) {
            if (key === "kind" || key === "span") {
                continue;
            }
            const child = record[key];
            if (Array.isArray(child)) {
                for (const item of child) {
                    stack.push(item);
                }
            } else {
                stack.push(child);
            }
        }
    }
}

/** All nodes in source order. */
export function nodes(script: Script): Node[] {
    const collected: Node[] = [];
    walkNodes(script, (node) => collected.push(node));
    collected.sort((a, b) => a.span.start - b.span.start);
    return collected;
}

/** The `n`th simple command in source order (includes nested substitutions). */
export function simpleCommand(script: Script, n = 0): SimpleCommand {
    const commands = nodes(script).filter(
        (node): node is SimpleCommand => node.kind === "SimpleCommand",
    );
    const command = commands[n];
    if (command === undefined) {
        throw new Error(`no simple command #${n}`);
    }
    return command;
}

/** The first command of the first pipeline of the script. */
export function firstCommand(script: Script): Command {
    const item = script.body.items[0];
    const member = item?.command.first.members[0];
    if (member === undefined) {
        throw new Error("no command in script");
    }
    return member.command;
}

/** The first command of `text`, narrowed to `kind`. */
export function commandOf<K extends Command["kind"]>(
    text: string,
    kind: K,
): Extract<Command, { kind: K }> {
    const command = firstCommand(parseOk(text));
    if (command.kind !== kind) {
        throw new Error(
            `expected a ${kind} in ${JSON.stringify(text)}, got ${command.kind}`,
        );
    }
    return command as Extract<Command, { kind: K }>;
}

/** The first simple command of `text`. */
export function simpleCommandOf(text: string, n = 0): SimpleCommand {
    return simpleCommand(parseOk(text), n);
}

function checkWordCoverage(
    word: Word,
    doc: SourceDocument,
    violations: string[],
): void {
    const parts = word.parts;
    if (parts.length === 0) {
        if (word.span.start !== word.span.end) {
            violations.push(
                `empty Word with non-empty span ${JSON.stringify(word.span)}`,
            );
        }
        return;
    }
    const first = parts[0];
    const last = parts[parts.length - 1];
    if (first === undefined || last === undefined) {
        return;
    }
    if (first.span.start !== word.span.start) {
        violations.push(
            `Word parts start ${first.span.start} != span start ${word.span.start}`,
        );
    }
    if (last.span.end !== word.span.end) {
        violations.push(`Word parts end ${last.span.end} != span end ${word.span.end}`);
    }
    let previous: number | undefined;
    for (const part of parts) {
        if (previous !== undefined && part.span.start !== previous) {
            violations.push(
                `Word part ${part.kind} at ${part.span.start} does not follow ${previous} in ${JSON.stringify(doc.text.slice(word.span.start, word.span.end))}`,
            );
        }
        previous = part.span.end;
    }
}

/**
 * Walks every node and checks that `doc.text.slice(span)` matches what the node
 * claims to be, and that word parts cover their word exactly. Returns the list
 * of violations (empty when the round-trip holds).
 */
export function checkSpans(doc: SourceDocument, script: Script): string[] {
    const violations: string[] = [];
    walkNodes(script, (node) => {
        const { start, end } = node.span;
        if (start < 0 || end > doc.text.length || start > end) {
            violations.push(
                `${node.kind} span out of bounds: ${JSON.stringify(node.span)}`,
            );
            return;
        }
        const raw = doc.text.slice(start, end);
        switch (node.kind) {
            case "Word":
                checkWordCoverage(node, doc, violations);
                break;
            case "SingleQuoted":
                if (
                    !raw.startsWith("'") ||
                    !raw.endsWith("'") ||
                    raw.slice(1, -1) !== node.value
                ) {
                    violations.push(`SingleQuoted mismatch: ${JSON.stringify(raw)}`);
                }
                break;
            case "AnsiCQuoted":
                if (!raw.startsWith("$'") || !raw.endsWith("'")) {
                    violations.push(`AnsiCQuoted mismatch: ${JSON.stringify(raw)}`);
                }
                break;
            case "DoubleQuoted":
                if (!raw.startsWith('"') || !raw.endsWith('"')) {
                    violations.push(`DoubleQuoted mismatch: ${JSON.stringify(raw)}`);
                }
                break;
            case "LocaleQuoted":
                if (!raw.startsWith('$"') || !raw.endsWith('"')) {
                    violations.push(`LocaleQuoted mismatch: ${JSON.stringify(raw)}`);
                }
                break;
            case "ParameterExpansion":
                if (!raw.startsWith("$")) {
                    violations.push(
                        `ParameterExpansion mismatch: ${JSON.stringify(raw)}`,
                    );
                }
                break;
            case "CommandSubstitution":
                if (!raw.startsWith("$(") && !raw.startsWith("`")) {
                    violations.push(
                        `CommandSubstitution mismatch: ${JSON.stringify(raw)}`,
                    );
                }
                break;
            case "ArithmeticExpansion":
                if (!raw.startsWith("$((") && !raw.startsWith("$[")) {
                    violations.push(
                        `ArithmeticExpansion mismatch: ${JSON.stringify(raw)}`,
                    );
                }
                break;
            case "ProcessSubstitution":
                if (!raw.startsWith("<(") && !raw.startsWith(">(")) {
                    violations.push(
                        `ProcessSubstitution mismatch: ${JSON.stringify(raw)}`,
                    );
                }
                break;
            case "Tilde":
                if (!raw.startsWith("~")) {
                    violations.push(`Tilde mismatch: ${JSON.stringify(raw)}`);
                }
                break;
            case "BraceExpansion":
                if (!raw.startsWith("{") || !raw.endsWith("}")) {
                    violations.push(`BraceExpansion mismatch: ${JSON.stringify(raw)}`);
                }
                break;
            default:
                break;
        }
    });
    return violations;
}

/** Asserts the span round-trip for a snippet and returns the script. */
export function expectSpans(text: string): Script {
    const { doc, script } = parseDoc(text);
    const violations = checkSpans(doc, script);
    expect(violations.slice(0, 5)).toEqual([]);
    return script;
}

/** Asserts that a snippet fails to parse and returns the error message. */
export function expectParseError(text: string): string {
    const result = parser.parse(createSourceDocument(text));
    expect(result.ok).toBe(false);
    if (result.ok) {
        throw new Error("expected a parse error");
    }
    return result.error.message;
}
