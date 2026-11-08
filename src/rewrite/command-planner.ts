/* eslint-disable sonarjs/cognitive-complexity, sonarjs/function-return-type */
/**
 * The three edit strategies for one invocation's replacement argv, from most
 * surgical to least:
 *
 * 1. word level — whole source words are inserted, deleted or kept;
 * 2. inline — a word that cannot be handled word by word is replaced wholesale
 *    by the quoted values that cover it;
 * 3. regenerate — the whole effective command range is rewritten.
 *
 * A `CommandPlanner` holds the fixed inputs of one invocation (its arguments,
 * document, redirections, word spans and quoter); the strategies only supply
 * the replacement and the gaps/words another strategy already consumed.
 */

import type { Invocation } from "../interp/invocation.ts";
import type { Arg } from "../interp/values.ts";
import type { Replacement } from "../rules/rule.ts";
import { indexRange } from "../rules/verdict.ts";
import { sameValues } from "../shared/guards.ts";
import type { Span } from "../syntax/index.ts";
import type { Alignment, Gap } from "./alignment.ts";
import { resolveValues } from "./resolve.ts";
import type { ShellQuoter } from "./shell-quoter.ts";
import type { TextEdit } from "./text-edit.ts";
import { wordRuns } from "./word-runs.ts";

export type PlanOutcome =
    | { readonly kind: "ok"; readonly edits: readonly TextEdit[] }
    | { readonly kind: "error"; readonly reason: string };

interface Window {
    readonly items: readonly string[];
}

function isWhitespace(char: string | undefined): boolean {
    return char === " " || char === "\t" || char === "\n" || char === undefined;
}

/** The end of the nearest word before `offset`, when only whitespace separates. */
function previousWordEnd(
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

export class CommandPlanner {
    private readonly args: readonly Arg[];
    private readonly doc: Invocation["doc"];
    private readonly redirects: readonly Span[];
    private readonly wordSpans: readonly Span[];

    constructor(
        invocation: Invocation,
        private readonly quoter: ShellQuoter,
    ) {
        this.args = invocation.argv;
        this.doc = invocation.doc;
        this.redirects = invocation.command.redirects.map((redirect) => redirect.span);
        this.wordSpans = wordSpansOf(invocation.fullArgv);
    }

    /** Strategy 1: whole-word edits for every gap of the invocation. */
    wordLevel(alignment: Alignment, skipGaps: ReadonlySet<number>): PlanOutcome {
        const anchorWords = new Set<unknown>();
        for (const anchor of alignment.anchors) {
            const word = this.args[anchor]?.word;
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
                    const word = this.args[deleted]?.word;
                    return word !== undefined && anchorWords.has(word);
                })
            ) {
                return { kind: "error", reason: "a word is only partially deleted" };
            }
            const planned = this.planGap(gap);
            if (planned.kind === "error") {
                return { kind: "error", reason: planned.reason };
            }
            if (planned.kind === "edit") {
                edits.push(planned.edit);
            }
        }
        return { kind: "ok", edits };
    }

    /** Strategy 3: replaces the words a word-level plan cannot express. */
    inline(
        reps: readonly Replacement[],
        alignment: Alignment,
        skipWords: ReadonlySet<unknown>,
    ): PlanOutcome {
        const edits: TextEdit[] = [];
        for (const run of wordRuns(this.args)) {
            if (skipWords.has(run.word)) {
                continue;
            }
            const fieldIndices = indexRange(run.start, run.end);
            const resolved = windowValues(this.args, reps, alignment, fieldIndices);
            if (resolved === undefined) {
                return { kind: "error", reason: "inline value is unknown" };
            }
            const original = fieldIndices.map((field) => this.args[field]?.value);
            if (sameValues(resolved.items, original)) {
                continue;
            }
            edits.push(this.inlineEdit(run.word.span, resolved.items));
        }
        return { kind: "ok", edits };
    }

    /** Strategy 4: rewrites the whole effective command range. */
    regenerate(reps: readonly Replacement[]): PlanOutcome {
        const first = this.args[0];
        const last = this.args[this.args.length - 1];
        if (first === undefined || last === undefined) {
            return { kind: "error", reason: "empty command" };
        }
        if (
            reps.some(
                (replacement) =>
                    replacement.kind === "arg" &&
                    (replacement.index < 0 || replacement.index >= this.args.length),
            )
        ) {
            return { kind: "error", reason: "replacement index out of range" };
        }
        if (this.args.some((arg) => arg.field.count !== 1)) {
            return { kind: "error", reason: "a word produced several fields" };
        }
        const start = first.word.span.start;
        const end = last.word.span.end;
        if (this.redirects.some((span) => span.start < end && span.end > start)) {
            return { kind: "error", reason: "redirect inside the command" };
        }
        const values = resolveValues(this.args, reps);
        if (values.some((value) => value === undefined)) {
            return { kind: "error", reason: "unknown value" };
        }
        let text = values.map((value) => this.quoter.quote(value as string)).join(" ");
        if (start > 0 && !isWhitespace(this.doc.text[start - 1])) {
            text = ` ${text}`;
        }
        if (end < this.doc.text.length && !isWhitespace(this.doc.text[end])) {
            text = `${text} `;
        }
        return { kind: "ok", edits: [{ doc: this.doc, start, end, text }] };
    }

    private planGap(gap: Gap): GapPlan {
        const insertions = gap.insertions;
        const deleted = gap.deleted;
        if (insertions.length === 0 && deleted.length === 0) {
            return { kind: "none" };
        }
        let start: number;
        let end: number;
        let text: string;
        if (deleted.length > 0) {
            const first = this.args[deleted[0] as number];
            const last = this.args[deleted[deleted.length - 1] as number];
            if (first === undefined || last === undefined) {
                return { kind: "error", reason: "deleted arg out of range" };
            }
            start = first.word.span.start;
            end = last.word.span.end;
            if (insertions.length > 0) {
                text = this.quoter.join(insertions);
                const next = gap.after === undefined ? undefined : this.args[gap.after];
                if (next !== undefined && end === next.word.span.start) {
                    text += " ";
                }
            } else {
                text = "";
                const swallowed = previousWordEnd(this.doc.text, this.wordSpans, start);
                if (swallowed !== undefined) {
                    start = swallowed;
                }
            }
        } else {
            const quoted = this.quoter.join(insertions);
            if (gap.after !== undefined) {
                const next = this.args[gap.after];
                if (next === undefined || next.field.index !== 0) {
                    return { kind: "error", reason: "no word boundary before anchor" };
                }
                start = next.word.span.start;
                end = start;
                text = `${quoted} `;
            } else if (gap.before !== undefined) {
                const previous = this.args[gap.before];
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
        if (this.redirects.some((span) => span.start < end && span.end > start)) {
            return { kind: "error", reason: "redirect inside the edit range" };
        }
        return { kind: "edit", edit: { doc: this.doc, start, end, text } };
    }

    private inlineEdit(span: Span, items: readonly string[]): TextEdit {
        if (items.length === 0) {
            return { doc: this.doc, start: span.start, end: span.end, text: "" };
        }
        let text = this.quoter.join(items);
        if (span.start > 0 && !isWhitespace(this.doc.text[span.start - 1])) {
            text = ` ${text}`;
        }
        if (span.end < this.doc.text.length && !isWhitespace(this.doc.text[span.end])) {
            text = `${text} `;
        }
        return { doc: this.doc, start: span.start, end: span.end, text };
    }
}

type GapPlan =
    | { readonly kind: "none" }
    | { readonly kind: "edit"; readonly edit: TextEdit }
    | { readonly kind: "error"; readonly reason: string };
