/* eslint-disable sonarjs/function-return-type */
/**
 * Strategy 2: folding a change to every use of a variable back into the
 * assignment that produced its value (`P="poetry run python"` instead of
 * inserting the runner before each `$P`).
 *
 * A use qualifies only when the variable's value can be reconstructed from the
 * replacement items that cover the use, when unquoted field splitting of the
 * new value reproduces those items exactly, and when *every* use of the binding
 * agrees on the same new value.
 */

import type { Binding } from "../interp/binding.ts";
import type { ScriptDocument } from "../interp/documents.ts";
import { type Arg, soleBinding } from "../interp/values.ts";
import { indexRange } from "../rules/verdict.ts";
import type { Word, WordPart } from "../syntax/index.ts";
import type { ShellQuoter } from "./shell-quoter.ts";
import { wordRuns } from "./word-runs.ts";

export type ValueStyle = "single" | "double" | "bare";

export interface BindingWord {
    readonly binding: Binding;
    readonly word: Word;
    readonly fieldIndices: readonly number[];
}

/** Every word of `args` that is one whole unquoted `$NAME`/`${NAME}` expansion. */
export function bindingWords(args: readonly Arg[]): BindingWord[] {
    const out: BindingWord[] = [];
    for (const run of wordRuns(args)) {
        const candidate = bindingWordFor(run.word, run.args, run.start, run.end);
        if (candidate !== undefined) {
            out.push(candidate);
        }
    }
    return out;
}

function bindingWordFor(
    word: Word,
    args: readonly Arg[],
    start: number,
    end: number,
): BindingWord | undefined {
    const parts = word.parts;
    if (parts.length !== 1 || parts[0]?.kind !== "ParameterExpansion") {
        return undefined;
    }
    const first = args[0];
    if (first === undefined) {
        return undefined;
    }
    const binding = soleBinding(first);
    if (binding === undefined) {
        return undefined;
    }
    if (!args.every((arg) => soleBinding(arg) === binding)) {
        return undefined;
    }
    return { binding, word, fieldIndices: indexRange(start, end) };
}

export interface EditableValue {
    readonly doc: ScriptDocument;
    readonly start: number;
    readonly end: number;
    readonly style: ValueStyle;
}

/** The editable value of an assignment, when it has a simple quotable shape. */
export function editableValue(binding: Binding): EditableValue | undefined {
    const assignment = binding.assignment;
    const doc = binding.doc;
    if (assignment === undefined || doc === undefined) {
        return undefined;
    }
    if (assignment.kind === "synthetic") {
        return undefined;
    }
    if (assignment.kind === "Assignment") {
        if (assignment.append || assignment.index !== undefined) {
            return undefined;
        }
        if (assignment.value.kind !== "Word") {
            return undefined;
        }
        const style = valueStyle(assignment.value);
        if (style === undefined) {
            return undefined;
        }
        return {
            doc,
            start: assignment.valueSpan.start,
            end: assignment.valueSpan.end,
            style,
        };
    }
    const word = assignment.word;
    if (assignment.parsed.append || assignment.parsed.index !== undefined) {
        return undefined;
    }
    const first = word.parts[0];
    if (first === undefined || first.kind !== "Literal") {
        return undefined;
    }
    const eq = first.value.indexOf("=");
    if (eq === -1) {
        return undefined;
    }
    const start = first.span.start + eq + 1;
    const end = word.span.end;
    if (word.parts.length === 1) {
        return { doc, start, end, style: "bare" };
    }
    const valuePart = word.parts[1];
    if (valuePart === undefined || word.parts.length !== 2) {
        return undefined;
    }
    const style = partStyle(valuePart);
    return style === undefined ? undefined : { doc, start, end, style };
}

function valueStyle(word: Word): ValueStyle | undefined {
    const parts = word.parts;
    if (parts.length !== 1) {
        return undefined;
    }
    const part = parts[0];
    return part === undefined ? undefined : partStyle(part);
}

function partStyle(part: WordPart): ValueStyle | undefined {
    switch (part.kind) {
        case "SingleQuoted":
            return "single";
        case "DoubleQuoted":
        case "LocaleQuoted":
            return "double";
        case "Literal":
        case "AnsiCQuoted":
            return "bare";
        default:
            return undefined;
    }
}

/** Renders `value` in `style`, keeping the assignment's original quoting. */
export function renderValue(
    value: string,
    style: ValueStyle,
    quoter: ShellQuoter,
): string {
    if (style === "single") {
        return quoter.single(value);
    }
    if (style === "double") {
        return quoter.double(value);
    }
    return quoter.quote(value);
}

/**
 * Whether an unquoted expansion of `value` splits back into exactly one word
 * equal to `value`: no IFS whitespace, glob or shell-special characters.
 */
export function splitSafe(value: string): boolean {
    if (value === "") {
        return false;
    }
    return /^[^\s*?[\]'"\\$`]+$/.test(value);
}
