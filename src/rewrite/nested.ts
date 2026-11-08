/* eslint-disable sonarjs/function-return-type, sonarjs/cognitive-complexity */
/**
 * Maps a nested document's edits back onto the outer document it was read from
 * (`bash -c '…'`, `watch python x.py`, a heredoc piped into a shell).
 *
 * When the outer source is a single literal argument, inner offsets map 1:1 and
 * only the inserted snippets need re-escaping for the outer quoting. A joined
 * nest maps per argument when every argument is one plain literal word and each
 * edit falls inside an argument or exactly on an argument boundary. Otherwise
 * the whole outer word (or joined range, or heredoc body) is replaced with the
 * new inner text, quoted in the original style.
 */

import type { ScriptDocument } from "../interp/documents.ts";
import { parentDocument } from "../interp/documents.ts";
import type { Invocation } from "../interp/invocation.ts";
import type { Arg } from "../interp/values.ts";
import type { Redirect, Word } from "../syntax/index.ts";
import type { ShellQuoter } from "./shell-quoter.ts";
import type { TextEdit } from "./text-edit.ts";

/** Replaces `invocation.fullArgv[start, end)` with `values`. */
export interface ValueOverride {
    readonly invocation: Invocation;
    readonly start: number;
    readonly end: number;
    readonly values: readonly string[];
}

export interface MappedNested {
    readonly edits: readonly TextEdit[];
    readonly overrides: readonly ValueOverride[];
}

export type NestedResult =
    | {
          readonly kind: "ok";
          readonly edits: readonly TextEdit[];
          readonly overrides: readonly ValueOverride[];
      }
    | { readonly kind: "error"; readonly reason: string };

interface LiteralContent {
    readonly context: "single" | "double" | "unquoted";
    readonly start: number;
    readonly end: number;
}

export function mapNested(
    doc: ScriptDocument,
    edits: readonly TextEdit[],
    newText: string,
    quoter: ShellQuoter,
): NestedResult {
    const nesting = doc.nesting;
    const parent = parentDocument(doc);
    if (nesting === undefined || parent === undefined) {
        return { kind: "error", reason: "nested document has no parent" };
    }
    if (newText === doc.text) {
        return { kind: "ok", edits: [], overrides: [] };
    }
    if (nesting.kind === "argument") {
        return mapArgument(
            parent,
            nesting.arg,
            nesting.invocation,
            doc.text.length,
            edits,
            newText,
            quoter,
        );
    }
    if (nesting.kind === "joined-arguments") {
        return mapJoined(
            parent,
            nesting.args,
            nesting.invocation,
            edits,
            newText,
            quoter,
        );
    }
    return mapHeredoc(parent, nesting.redirect, newText);
}

function mapArgument(
    parent: ScriptDocument,
    arg: Arg,
    invocation: Invocation,
    innerLength: number,
    edits: readonly TextEdit[],
    newText: string,
    quoter: ShellQuoter,
): NestedResult {
    const word = arg.word;
    const literal = literalContent(parent.text, word);
    const index = invocation.fullArgv.indexOf(arg);
    const override =
        index < 0
            ? []
            : [{ invocation, start: index, end: index + 1, values: [newText] }];
    if (
        literal !== undefined &&
        literal.end - literal.start === innerLength &&
        arg.value === parent.text.slice(literal.start, literal.end)
    ) {
        const mapped = edits.map((edit): TextEdit => ({
            doc: parent,
            start: literal.start + edit.start,
            end: literal.start + edit.end,
            text: reescape(quoter, edit.text, literal.context),
        }));
        return { kind: "ok", edits: mapped, overrides: override };
    }
    const rendered = requote(word, newText, quoter);
    if (rendered === undefined) {
        return { kind: "error", reason: "cannot re-quote the outer word" };
    }
    return {
        kind: "ok",
        edits: [
            { doc: parent, start: word.span.start, end: word.span.end, text: rendered },
        ],
        overrides: override,
    };
}

interface Segment {
    readonly word: Word;
    readonly innerStart: number;
    readonly innerEnd: number;
    readonly literalStart: number;
    readonly context: LiteralContent["context"];
}

function mapJoined(
    parent: ScriptDocument,
    args: readonly Arg[],
    invocation: Invocation,
    edits: readonly TextEdit[],
    newText: string,
    quoter: ShellQuoter,
): NestedResult {
    if (args.length === 0) {
        return { kind: "error", reason: "empty joined script" };
    }
    const segments: Segment[] = [];
    let offset = 0;
    for (const arg of args) {
        const value = arg.value;
        const literal = literalContent(parent.text, arg.word);
        if (
            value === undefined ||
            literal === undefined ||
            literal.end - literal.start !== value.length
        ) {
            return { kind: "error", reason: "joined argument is not a plain word" };
        }
        segments.push({
            word: arg.word,
            innerStart: offset,
            innerEnd: offset + value.length,
            literalStart: literal.start,
            context: literal.context,
        });
        offset += value.length + 1;
    }
    const last = segments[segments.length - 1];
    const innerLength = last === undefined ? 0 : last.innerEnd;
    const mapped: TextEdit[] = [];
    for (const edit of edits) {
        const result = mapJoinedEdit(parent, segments, innerLength, edit, quoter);
        if (result === undefined) {
            return { kind: "error", reason: "joined edit does not fit an argument" };
        }
        mapped.push(result);
    }
    const first = invocation.fullArgv.indexOf(args[0] as Arg);
    const lastIndex = invocation.fullArgv.indexOf(args[args.length - 1] as Arg);
    const overrides: ValueOverride[] =
        first < 0 || lastIndex < 0
            ? []
            : [
                  {
                      invocation,
                      start: first,
                      end: lastIndex + 1,
                      values: splitWords(newText),
                  },
              ];
    return { kind: "ok", edits: mapped, overrides };
}

function mapJoinedEdit(
    parent: ScriptDocument,
    segments: readonly Segment[],
    innerLength: number,
    edit: TextEdit,
    quoter: ShellQuoter,
): TextEdit | undefined {
    if (edit.start === edit.end) {
        const at = edit.start;
        if (at === innerLength) {
            const last = segments[segments.length - 1];
            return last === undefined
                ? undefined
                : afterWord(parent, last.word, edit.text);
        }
        for (const segment of segments) {
            if (at === segment.innerStart) {
                return beforeWord(parent, segment.word, edit.text);
            }
            if (at === segment.innerEnd) {
                return afterWord(parent, segment.word, edit.text);
            }
        }
        return undefined;
    }
    for (const segment of segments) {
        if (edit.start >= segment.innerStart && edit.end <= segment.innerEnd) {
            const start = segment.literalStart + (edit.start - segment.innerStart);
            const end = segment.literalStart + (edit.end - segment.innerStart);
            return {
                doc: parent,
                start,
                end,
                text: reescape(quoter, edit.text, segment.context),
            };
        }
    }
    return undefined;
}

function beforeWord(doc: ScriptDocument, word: Word, snippet: string): TextEdit {
    const text = /\s$/.test(snippet) ? snippet : `${snippet} `;
    return { doc, start: word.span.start, end: word.span.start, text };
}

function afterWord(doc: ScriptDocument, word: Word, snippet: string): TextEdit {
    const text = /^\s/.test(snippet) ? snippet : ` ${snippet}`;
    return { doc, start: word.span.end, end: word.span.end, text };
}

function splitWords(text: string): string[] {
    return text.split(/\s+/).filter((word) => word !== "");
}

function mapHeredoc(
    parent: ScriptDocument,
    redirect: Redirect | undefined,
    newText: string,
): NestedResult {
    const target = redirect?.target;
    if (target === undefined || target.kind !== "HereDoc" || !target.quoted) {
        return { kind: "error", reason: "unquoted heredoc cannot be rewritten" };
    }
    return {
        kind: "ok",
        edits: [
            {
                doc: parent,
                start: target.bodySpan.start,
                end: target.bodySpan.end,
                text: newText,
            },
        ],
        overrides: [],
    };
}

/** The single literal part of a word, and where its content sits. */
function literalContent(text: string, word: Word): LiteralContent | undefined {
    const parts = word.parts;
    if (parts.length !== 1) {
        return undefined;
    }
    const part = parts[0];
    if (part === undefined) {
        return undefined;
    }
    if (part.kind === "SingleQuoted") {
        return {
            context: "single",
            start: part.span.start + 1,
            end: part.span.end - 1,
        };
    }
    if (part.kind === "Literal") {
        if (text.slice(part.span.start, part.span.end) !== part.value) {
            return undefined;
        }
        return { context: "unquoted", start: part.span.start, end: part.span.end };
    }
    if (part.kind === "DoubleQuoted" || part.kind === "LocaleQuoted") {
        const inner = part.parts;
        const only = inner.length === 1 ? inner[0] : undefined;
        if (only !== undefined && only.kind === "Literal") {
            if (text.slice(only.span.start, only.span.end) !== only.value) {
                return undefined;
            }
            return { context: "double", start: only.span.start, end: only.span.end };
        }
    }
    return undefined;
}

function requote(word: Word, value: string, quoter: ShellQuoter): string | undefined {
    const parts = word.parts;
    if (parts.length === 1) {
        const part = parts[0];
        if (part?.kind === "SingleQuoted") {
            return quoter.single(value);
        }
        if (part?.kind === "DoubleQuoted" || part?.kind === "LocaleQuoted") {
            return quoter.double(value);
        }
    }
    return quoter.quote(value);
}

function reescape(
    quoter: ShellQuoter,
    snippet: string,
    context: LiteralContent["context"],
): string {
    return quoter.quote(snippet, context);
}
