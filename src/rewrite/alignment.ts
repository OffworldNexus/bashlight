/* eslint-disable sonarjs/function-return-type */
/**
 * Alignment of a rule's replacement argv with the original effective argv.
 *
 * The replacements reference original arguments (`{ kind: "arg", index }`) and
 * insert new literal words (`{ kind: "text", value }`). When the referenced
 * indices strictly increase, the new argv is an interleaving of kept arguments
 * (the *anchors*) and inserted texts; the arguments between two anchors are
 * deleted. Every anchor sits in exactly one gap, and the gaps are what the
 * rewriter edits.
 */

import type { Arg } from "../interp/values.ts";
import type { Replacement } from "../rules/rule.ts";
import { indexRange } from "../rules/verdict.ts";

/** The arguments and insertions between two anchors (or before/after them). */
export interface Gap {
    /** Index of the anchor before the gap, if any. */
    readonly before: number | undefined;
    /** Index of the anchor after the gap, if any. */
    readonly after: number | undefined;
    /** Original argument indices dropped inside the gap. */
    readonly deleted: readonly number[];
    /** Inserted text values, in replacement order. */
    readonly insertions: readonly string[];
}

export interface Alignment {
    /** Original argument indices kept, increasing. */
    readonly anchors: readonly number[];
    /** Original argument index → position in the replacement argv. */
    readonly repOfAnchor: ReadonlyMap<number, number>;
    /** Original argument indices not referenced by any `arg`. */
    readonly deleted: readonly number[];
    readonly gaps: readonly Gap[];
}

export type AlignmentResult =
    | { readonly ok: true; readonly alignment: Alignment }
    | { readonly ok: false; readonly unordered: boolean; readonly reason: string };

/** Index of the gap between `before` and `after` (either may be undefined). */
export function gapIndex(
    alignment: Alignment,
    before: number | undefined,
    after: number | undefined,
): number | undefined {
    const index = alignment.gaps.findIndex(
        (gap) => gap.before === before && gap.after === after,
    );
    return index < 0 ? undefined : index;
}

export function align(
    args: readonly Arg[],
    reps: readonly Replacement[],
): AlignmentResult {
    const anchors: number[] = [];
    const repOfAnchor = new Map<number, number>();
    let previous = -1;
    let unordered = false;
    for (let position = 0; position < reps.length; position += 1) {
        const replacement = reps[position];
        if (replacement === undefined || replacement.kind === "text") {
            continue;
        }
        if (replacement.index < 0 || replacement.index >= args.length) {
            return {
                ok: false,
                unordered: false,
                reason: `replacement index ${replacement.index} out of range`,
            };
        }
        if (replacement.index <= previous) {
            unordered = true;
        }
        previous = replacement.index;
        anchors.push(replacement.index);
        repOfAnchor.set(replacement.index, position);
    }
    if (unordered) {
        return { ok: false, unordered: true, reason: "replacement args are reordered" };
    }
    const anchorSet = new Set(anchors);
    const deleted: number[] = [];
    for (let index = 0; index < args.length; index += 1) {
        if (!anchorSet.has(index)) {
            deleted.push(index);
        }
    }
    return {
        ok: true,
        alignment: {
            anchors,
            repOfAnchor,
            deleted,
            gaps: buildGaps(reps, anchors, repOfAnchor, args.length),
        },
    };
}

function insertionsBetween(
    reps: readonly Replacement[],
    from: number,
    to: number,
): string[] {
    const out: string[] = [];
    for (let position = from; position < to; position += 1) {
        const replacement = reps[position];
        if (replacement?.kind === "text") {
            out.push(replacement.value);
        }
    }
    return out;
}

function buildGaps(
    reps: readonly Replacement[],
    anchors: readonly number[],
    repOfAnchor: ReadonlyMap<number, number>,
    argCount: number,
): Gap[] {
    const first = anchors[0];
    if (first === undefined) {
        return [
            {
                before: undefined,
                after: undefined,
                deleted: indexRange(0, argCount),
                insertions: insertionsBetween(reps, 0, reps.length),
            },
        ];
    }
    const positions = anchors.map((anchor) => repOfAnchor.get(anchor) ?? 0);
    const gaps: Gap[] = [
        {
            before: undefined,
            after: first,
            deleted: indexRange(0, first),
            insertions: insertionsBetween(reps, 0, positions[0] ?? 0),
        },
    ];
    for (let k = 1; k < anchors.length; k += 1) {
        const before = anchors[k - 1] as number;
        const after = anchors[k] as number;
        gaps.push({
            before,
            after,
            deleted: indexRange(before + 1, after),
            insertions: insertionsBetween(
                reps,
                (positions[k - 1] as number) + 1,
                positions[k] as number,
            ),
        });
    }
    const last = anchors[anchors.length - 1] as number;
    gaps.push({
        before: last,
        after: undefined,
        deleted: indexRange(last + 1, argCount),
        insertions: insertionsBetween(
            reps,
            (positions[positions.length - 1] as number) + 1,
            reps.length,
        ),
    });
    return gaps;
}
