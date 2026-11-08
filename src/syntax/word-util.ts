// Word-part values are optional by design (unknown expansions).
/* eslint-disable sonarjs/function-return-type */
/**
 * Word-part bookkeeping shared by the word and expansion parsers: value
 * folding and the merging of adjacent literal parts (so a word is always a
 * contiguous run of parts).
 */

import type { Word, WordPart } from "./ast.ts";

export function partValue(part: WordPart): string | undefined {
    switch (part.kind) {
        case "Literal":
            return part.value;
        case "SingleQuoted":
            return part.value;
        case "DoubleQuoted":
            return part.value;
        case "AnsiCQuoted":
            return part.value;
        case "LocaleQuoted":
            return part.value;
        case "Tilde":
            return part.value;
        case "ParameterExpansion":
        case "CommandSubstitution":
        case "ArithmeticExpansion":
        case "ProcessSubstitution":
        case "BraceExpansion":
            return undefined;
    }
}

export function combineValues(parts: readonly WordPart[]): string | undefined {
    let out = "";
    for (const part of parts) {
        const value = partValue(part);
        if (value === undefined) {
            return undefined;
        }
        out += value;
    }
    return out;
}

export function emptyWord(at: number): Word {
    return { kind: "Word", parts: [], value: "", span: { start: at, end: at } };
}

/** Appends to the trailing literal, or starts a new one. */
export function appendLiteral(
    parts: WordPart[],
    value: string,
    hasGlob: boolean,
    start: number,
    end: number,
): void {
    const last = parts[parts.length - 1];
    if (last !== undefined && last.kind === "Literal" && last.span.end === start) {
        parts[parts.length - 1] = {
            kind: "Literal",
            value: last.value + value,
            hasGlob: last.hasGlob || hasGlob,
            span: { start: last.span.start, end },
        };
        return;
    }
    parts.push({ kind: "Literal", value, hasGlob, span: { start, end } });
}

/** Extends the trailing literal's span over a line continuation (no value). */
export function extendLastLiteral(parts: WordPart[], end: number): void {
    const last = parts[parts.length - 1];
    if (last !== undefined && last.kind === "Literal") {
        parts[parts.length - 1] = { ...last, span: { start: last.span.start, end } };
        return;
    }
    parts.push({
        kind: "Literal",
        value: "",
        hasGlob: false,
        span: { start: end - 2, end },
    });
}

/** Pushes a part, merging a plain `$` literal into the preceding literal. */
export function pushPart(parts: WordPart[], part: WordPart): void {
    if (part.kind === "Literal") {
        appendLiteral(parts, part.value, part.hasGlob, part.span.start, part.span.end);
        return;
    }
    parts.push(part);
}
