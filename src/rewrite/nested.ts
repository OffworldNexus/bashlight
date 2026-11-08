/* eslint-disable sonarjs/function-return-type */
/**
 * Maps a nested document's edits back onto the outer document it was read from
 * (`bash -c '…'`, `ssh host a b c`, a heredoc piped into a shell).
 *
 * When the outer source is a single literal argument, inner offsets map 1:1
 * and only the inserted snippets need re-escaping for the outer quoting.
 * Otherwise the whole outer word (or joined range, or heredoc body) is replaced
 * with the new inner text, quoted in the original style.
 */

import type { ScriptDocument } from "../interp/documents.ts";
import type { Invocation } from "../interp/invocation.ts";
import type { Arg } from "../interp/values.ts";
import type { Redirect, Word } from "../syntax/index.ts";
import type { ShellQuoter } from "./shell-quoter.ts";
import type { TextEdit } from "./text-edit.ts";

/** The new value of the outer argument a nested edit changes, if any. */
export interface ValueOverride {
    readonly invocation: Invocation;
    /** Index into `invocation.fullArgv`. */
    readonly index: number;
    readonly value: string;
}

export interface MappedNested {
    readonly edits: readonly TextEdit[];
    readonly override: ValueOverride | undefined;
}

export type NestedResult = MappedNested | { readonly error: string };

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
    const parent = doc.parent?.doc as ScriptDocument | undefined;
    if (nesting === undefined || parent === undefined) {
        return { error: "nested document has no parent" };
    }
    if (newText === doc.text) {
        return { edits: [], override: undefined };
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
        return mapJoined(parent, nesting.args, newText, quoter);
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
    if (
        literal !== undefined &&
        literal.end - literal.start === innerLength &&
        arg.value === parent.text.slice(literal.start, literal.end)
    ) {
        const mapped = edits.map((edit): TextEdit => ({
            doc: parent,
            start: literal.start + edit.start,
            end: literal.start + edit.end,
            text: reescape(edit.text, literal.context),
        }));
        return {
            edits: mapped,
            override: index < 0 ? undefined : { invocation, index, value: newText },
        };
    }
    const rendered = requote(word, newText, quoter);
    if (rendered === undefined) {
        return { error: "cannot re-quote the outer word" };
    }
    return {
        edits: [
            { doc: parent, start: word.span.start, end: word.span.end, text: rendered },
        ],
        override: index < 0 ? undefined : { invocation, index, value: newText },
    };
}

function mapJoined(
    parent: ScriptDocument,
    args: readonly Arg[],
    newText: string,
    quoter: ShellQuoter,
): NestedResult {
    const first = args[0];
    const last = args[args.length - 1];
    if (first === undefined || last === undefined) {
        return { error: "empty joined script" };
    }
    return {
        edits: [
            {
                doc: parent,
                start: first.word.span.start,
                end: last.word.span.end,
                text: quoter.quote(newText),
            },
        ],
        override: undefined,
    };
}

function mapHeredoc(
    parent: ScriptDocument,
    redirect: Redirect | undefined,
    newText: string,
): NestedResult {
    const target = redirect?.target;
    if (target === undefined || target.kind !== "HereDoc" || !target.quoted) {
        return { error: "unquoted heredoc cannot be rewritten" };
    }
    return {
        edits: [
            {
                doc: parent,
                start: target.bodySpan.start,
                end: target.bodySpan.end,
                text: newText,
            },
        ],
        override: undefined,
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
            return `'${value.replaceAll("'", "'\\''")}'`;
        }
        if (part?.kind === "DoubleQuoted" || part?.kind === "LocaleQuoted") {
            return `"${escapeDouble(value)}"`;
        }
    }
    return quoter.quote(value);
}

function reescape(snippet: string, context: LiteralContent["context"]): string {
    if (context === "single") {
        return snippet.replaceAll("'", "'\\''");
    }
    if (context === "double") {
        return escapeDouble(snippet);
    }
    return snippet;
}

function escapeDouble(value: string): string {
    return value.replace(/[\\$`"]/g, "\\$&");
}
