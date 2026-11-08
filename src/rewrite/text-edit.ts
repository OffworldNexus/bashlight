/* eslint-disable sonarjs/function-return-type */
/**
 * A source edit: replaces the `[start, end)` range of `doc` with `text`.
 * Edits are always expressed in the coordinates of their own document, so a
 * nested document's edits have to be mapped onto its parent before they can be
 * applied to the top-level command.
 */

import type { ScriptDocument } from "../interp/documents.ts";

export interface TextEdit {
    readonly doc: ScriptDocument;
    readonly start: number;
    readonly end: number;
    readonly text: string;
}

/** Applies non-overlapping edits to `text`; `undefined` on an overlap. */
export function applyEdits(
    text: string,
    edits: readonly TextEdit[],
): string | undefined {
    const sorted = [...edits].sort(
        (left, right) => left.start - right.start || left.end - right.end,
    );
    let out = "";
    let cursor = 0;
    for (const edit of sorted) {
        if (edit.start < cursor || edit.end < edit.start) {
            return undefined;
        }
        out += text.slice(cursor, edit.start) + edit.text;
        cursor = edit.end;
    }
    return out + text.slice(cursor);
}
