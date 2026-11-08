/* eslint-disable sonarjs/cognitive-complexity, sonarjs/function-return-type */
/**
 * Plans the source edits for one replacement argv, from most surgical to least:
 *
 * 1. word level — whole source words are inserted, deleted or kept;
 * 2. inline — a word that cannot be handled word by word is replaced wholesale
 *    by the quoted values that cover it;
 * 3. regenerate — the whole effective command range is rewritten.
 *
 * The functions here only produce edits; the caller owns conflict resolution,
 * binding edits and validation.
 */

import type { ScriptDocument } from "../interp/documents.ts";
import type { Invocation } from "../interp/invocation.ts";
import type { Arg } from "../interp/values.ts";
import type { Replacement } from "../rules/rule.ts";
import { indexRange } from "../rules/verdict.ts";
import type { Span } from "../syntax/index.ts";
import type { Alignment, Gap } from "./alignment.ts";
import type { ShellQuoter } from "./shell-quoter.ts";
import type { TextEdit } from "./text-edit.ts";

export type GapPlan =
    | { readonly kind: "none" }
    | { readonly kind: "edit"; readonly edit: TextEdit }
    | { readonly kind: "error"; readonly reason: string };

export interface GapInput {
    readonly doc: ScriptDocument;
    readonly args: readonly Arg[];
    readonly gap: Gap;
    readonly redirects: readonly Span[];
    /** Every word of the command, wrapper words included. */
    readonly wordSpans: readonly Span[];
    readonly quoter: ShellQuoter;
}

function isWhitespace(char: string | undefined): boolean {
    return char === " " || char === "\t" || char === "\n" || char === undefined;
}

/** The end of the nearest word before `offset`, when only whitespace separates. */
export function previousWordEnd(
    text: string,
    wordSpans: readonly Span[],
    offset: number,
): number | undefined {
    let best: number | undefined;
    for (const span of wordSpans) {
        if (span.end <= offset && (best === undefined || span.end > best)) {
            best = span.end;
        }
    }
    if (best === undefined) {
        return undefined;
    }
    return text.slice(best, offset).trim() === "" ? best : undefined;
}

export function planGap(input: GapInput): GapPlan {
    const { args, gap, doc, quoter } = input;
    const insertions = gap.insertions;
    const deleted = gap.deleted;
    if (insertions.length === 0 && deleted.length === 0) {
        return { kind: "none" };
    }
    let start: number;
    let end: number;
    let text: string;
    if (deleted.length > 0) {
        const first = args[deleted[0] as number];
        const last = args[deleted[deleted.length - 1] as number];
        if (first === undefined || last === undefined) {
            return { kind: "error", reason: "deleted arg out of range" };
        }
        start = first.word.span.start;
        end = last.word.span.end;
        if (insertions.length > 0) {
            text = quoter.join(insertions);
            const next = gap.after === undefined ? undefined : args[gap.after];
            if (next !== undefined && end === next.word.span.start) {
                text += " ";
            }
        } else {
            text = "";
            const swallowed = previousWordEnd(doc.text, input.wordSpans, start);
            if (swallowed !== undefined) {
                start = swallowed;
            }
        }
    } else {
        const quoted = quoter.join(insertions);
        if (gap.after !== undefined) {
            const next = args[gap.after];
            if (next === undefined || next.field.index !== 0) {
                return { kind: "error", reason: "no word boundary before anchor" };
            }
            start = next.word.span.start;
            end = start;
            text = `${quoted} `;
        } else if (gap.before !== undefined) {
            const previous = args[gap.before];
            const count = previous?.field.count;
            if (
                previous === undefined ||
                count === undefined ||
                previous.field.index !== count - 1
            ) {
                return { kind: "error", reason: "no word boundary after anchor" };
            }
            start = previous.word.span.end;
            end = start;
            text = ` ${quoted}`;
        } else {
            return { kind: "error", reason: "gap has no anchor" };
        }
    }
    if (start > end) {
        return { kind: "error", reason: "inverted range" };
    }
    if (input.redirects.some((span) => span.start < end && span.end > start)) {
        return { kind: "error", reason: "redirect inside the edit range" };
    }
    return { kind: "edit", edit: { doc, start, end, text } };
}

function wordSpansOf(args: readonly Arg[]): readonly Span[] {
    const seen = new Set<unknown>();
    const spans: Span[] = [];
    for (const arg of args) {
        if (!seen.has(arg.word)) {
            seen.add(arg.word);
            spans.push(arg.word.span);
        }
    }
    return spans;
}

export type WordLevelPlan =
    | { readonly kind: "ok"; readonly edits: readonly TextEdit[] }
    | { readonly kind: "error"; readonly reason: string };

/** Strategy 1: whole-word edits for every gap of the invocation. */
export function planWordLevel(
    invocation: Invocation,
    alignment: Alignment,
    quoter: ShellQuoter,
    skipGaps: ReadonlySet<number>,
): WordLevelPlan {
    const args = invocation.argv;
    const redirects = invocation.command.redirects.map((redirect) => redirect.span);
    const wordSpans = wordSpansOf(invocation.fullArgv);
    const anchorWords = new Set<unknown>();
    for (const anchor of alignment.anchors) {
        const word = args[anchor]?.word;
        if (word !== undefined) {
            anchorWords.add(word);
        }
    }
    const edits: TextEdit[] = [];
    for (let index = 0; index < alignment.gaps.length; index += 1) {
        if (skipGaps.has(index)) {
            continue;
        }
        const gap = alignment.gaps[index];
        if (gap === undefined) {
            continue;
        }
        if (
            gap.deleted.some((deleted) => {
                const word = args[deleted]?.word;
                return word !== undefined && anchorWords.has(word);
            })
        ) {
            return { kind: "error", reason: "a word is only partially deleted" };
        }
        const plan = planGap({
            doc: invocation.doc,
            args,
            gap,
            redirects,
            wordSpans,
            quoter,
        });
        if (plan.kind === "error") {
            return { kind: "error", reason: plan.reason };
        }
        if (plan.kind === "edit") {
            edits.push(plan.edit);
        }
    }
    return { kind: "ok", edits };
}

/** Strategy 3: replaces the words a word-level plan cannot express. */
export function planInline(
    invocation: Invocation,
    reps: readonly Replacement[],
    alignment: Alignment,
    quoter: ShellQuoter,
    skipWords: ReadonlySet<unknown>,
): WordLevelPlan {
    const args = invocation.argv;
    const edits: TextEdit[] = [];
    let index = 0;
    while (index < args.length) {
        const arg = args[index];
        if (arg === undefined) {
            index += 1;
            continue;
        }
        const word = arg.word;
        let end = index;
        while (end < args.length && args[end]?.word === word) {
            end += 1;
        }
        const fieldIndices = indexRange(index, end);
        index = end;
        if (skipWords.has(word)) {
            continue;
        }
        const resolved = windowValues(args, reps, alignment, fieldIndices);
        if (resolved === undefined) {
            return { kind: "error", reason: "inline value is unknown" };
        }
        const original = fieldIndices.map((field) => args[field]?.value);
        if (sameStrings(resolved.items, original)) {
            continue;
        }
        edits.push(inlineEdit(invocation.doc, word.span, resolved.items, quoter));
    }
    return { kind: "ok", edits };
}

interface Window {
    readonly items: readonly string[];
}

/** The new values covering a run of arguments, including absorbed insertions. */
export function windowValues(
    args: readonly Arg[],
    reps: readonly Replacement[],
    alignment: Alignment,
    fieldIndices: readonly number[],
): Window | undefined {
    const present = fieldIndices
        .map((field) => alignment.repOfAnchor.get(field))
        .filter((position): position is number => position !== undefined);
    if (present.length === 0) {
        return { items: [] };
    }
    const first = Math.min(...present);
    const last = Math.max(...present);
    const items: string[] = [];
    for (let position = first - 1; position >= 0; position -= 1) {
        const replacement = reps[position];
        if (replacement?.kind !== "text") {
            break;
        }
        items.unshift(replacement.value);
    }
    for (let position = first; position <= last; position += 1) {
        const replacement = reps[position];
        if (replacement === undefined) {
            continue;
        }
        if (replacement.kind === "text") {
            items.push(replacement.value);
            continue;
        }
        const value = args[replacement.index]?.value;
        if (value === undefined) {
            return undefined;
        }
        items.push(value);
    }
    return { items };
}

function inlineEdit(
    doc: ScriptDocument,
    span: Span,
    items: readonly string[],
    quoter: ShellQuoter,
): TextEdit {
    if (items.length === 0) {
        return { doc, start: span.start, end: span.end, text: "" };
    }
    let text = quoter.join(items);
    if (span.start > 0 && !isWhitespace(doc.text[span.start - 1])) {
        text = ` ${text}`;
    }
    if (span.end < doc.text.length && !isWhitespace(doc.text[span.end])) {
        text = `${text} `;
    }
    return { doc, start: span.start, end: span.end, text };
}

function sameStrings(
    left: readonly string[],
    right: readonly (string | undefined)[],
): boolean {
    return (
        left.length === right.length &&
        left.every((value, index) => value === right[index])
    );
}

/** Strategy 4: rewrites the whole effective command range. */
export function planRegenerate(
    invocation: Invocation,
    reps: readonly Replacement[],
    quoter: ShellQuoter,
): WordLevelPlan {
    const args = invocation.argv;
    const first = args[0];
    const last = args[args.length - 1];
    if (first === undefined || last === undefined) {
        return { kind: "error", reason: "empty command" };
    }
    if (
        reps.some(
            (replacement) =>
                replacement.kind === "arg" &&
                (replacement.index < 0 || replacement.index >= args.length),
        )
    ) {
        return { kind: "error", reason: "replacement index out of range" };
    }
    if (args.some((arg) => arg.field.count !== 1)) {
        return { kind: "error", reason: "a word produced several fields" };
    }
    const start = first.word.span.start;
    const end = last.word.span.end;
    const redirects = invocation.command.redirects.map((redirect) => redirect.span);
    if (redirects.some((span) => span.start < end && span.end > start)) {
        return { kind: "error", reason: "redirect inside the command" };
    }
    const values = reps.map((replacement) =>
        replacement.kind === "text"
            ? replacement.value
            : args[replacement.index]?.value,
    );
    if (values.some((value) => value === undefined)) {
        return { kind: "error", reason: "unknown value" };
    }
    let text = values.map((value) => quoter.quote(value as string)).join(" ");
    if (start > 0 && !isWhitespace(invocation.doc.text[start - 1])) {
        text = ` ${text}`;
    }
    if (end < invocation.doc.text.length && !isWhitespace(invocation.doc.text[end])) {
        text = `${text} `;
    }
    return { kind: "ok", edits: [{ doc: invocation.doc, start, end, text }] };
}
