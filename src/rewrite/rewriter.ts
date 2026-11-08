/* eslint-disable sonarjs/cognitive-complexity, sonarjs/function-return-type */
/**
 * Orchestrates rewriting: aligns each decision with its invocation, plans the
 * most surgical edits (binding → word level → inline → regenerate), evaluates
 * cross-invocation binding edits, maps nested documents bottom-up, resolves
 * edit conflicts and returns the new top-level command.
 *
 * The rewriter never validates; that is the validator's job, so a buggy plan
 * can never change a command that fails the round-trip check.
 */

import type { Binding, BindingUse } from "../interp/binding.ts";
import type { ScriptDocument } from "../interp/documents.ts";
import type { Interpretation } from "../interp/interpreter.ts";
import type { Invocation } from "../interp/invocation.ts";
import type { Decision } from "../rules/rule-engine.ts";
import type { Alignment } from "./alignment.ts";
import { align, gapIndex } from "./alignment.ts";
import { bindingWords, editableValue, renderValue, splitSafe } from "./binding-edit.ts";
import { mapNested } from "./nested.ts";
import { ShellQuoter } from "./shell-quoter.ts";
import { applyEdits, type TextEdit } from "./text-edit.ts";
import {
    planInline,
    planRegenerate,
    planWordLevel,
    windowValues,
} from "./word-level.ts";

export type ReplaceDecision = Extract<Decision, { kind: "replace" }>;

/** One invocation a rule wants to change, with the rule's verdict. */
export interface RewriteTarget {
    readonly invocation: Invocation;
    readonly decision: ReplaceDecision;
}

export interface RewrittenTarget {
    readonly target: RewriteTarget;
    /** The resolved new effective argv (unknown values stay `undefined`). */
    readonly values: readonly (string | undefined)[];
    readonly env: Readonly<Record<string, string>>;
}

export interface GivenUpTarget {
    readonly target: RewriteTarget;
    readonly reason: string;
}

export interface PlanResult {
    /** The new top-level command (identical to the original on total failure). */
    readonly command: string;
    readonly rewritten: readonly RewrittenTarget[];
    readonly givenUp: readonly GivenUpTarget[];
    /** New effective argv values for invocations changed by a nested rewrite. */
    readonly overrides: ReadonlyMap<
        Invocation,
        ReadonlyMap<number, string | undefined>
    >;
}

export interface PlanInput {
    readonly interpretation: Interpretation;
    readonly targets: readonly RewriteTarget[];
    /** Every invocation that belongs to a target (a node can run several times). */
    readonly ownerOf: ReadonlyMap<Invocation, number>;
}

interface OwnedEdit {
    readonly edit: TextEdit;
    readonly owners: readonly number[];
}

interface TargetPlan {
    readonly index: number;
    readonly target: RewriteTarget;
    readonly alignment: Alignment | undefined;
    readonly unordered: boolean;
}

interface Consumed {
    readonly gaps: Set<number>;
    readonly words: Set<unknown>;
}

export class Rewriter {
    constructor(private readonly quoter: ShellQuoter = new ShellQuoter()) {}

    plan(input: PlanInput): PlanResult {
        const failures = new Map<number, string>();
        const plans = this.buildPlans(input, failures);
        const consumed = new Map<number, Consumed>();
        const assignmentEdits = this.evaluateBindings(input, plans, consumed);
        const editsByDoc = new Map<ScriptDocument, OwnedEdit[]>();
        const add = (edit: TextEdit, owners: readonly number[]): void => {
            const list = editsByDoc.get(edit.doc);
            if (list === undefined) {
                editsByDoc.set(edit.doc, [{ edit, owners }]);
            } else {
                list.push({ edit, owners });
            }
        };

        for (const plan of plans) {
            const planned = this.planEdits(plan, consumed.get(plan.index), failures);
            if (planned === undefined) {
                continue;
            }
            for (const edit of planned) {
                add(edit, [plan.index]);
            }
        }
        for (const assignment of assignmentEdits) {
            add(assignment.edit, assignment.owners);
        }

        const dropped = new Set(failures.keys());
        // A binding edit shared by several targets cannot survive one failing.
        for (const assignment of assignmentEdits) {
            if (assignment.owners.some((owner) => dropped.has(owner))) {
                for (const owner of assignment.owners) {
                    dropped.add(owner);
                    failures.set(owner, "a shared binding edit was dropped");
                }
            }
        }

        const overrides = new Map<Invocation, Map<number, string | undefined>>();
        const top = input.interpretation.documents[0];
        const nested = input.interpretation.documents
            .filter((doc): doc is ScriptDocument => doc !== top)
            .sort((left, right) => depth(right) - depth(left));
        for (const doc of nested) {
            this.mapDocument(doc, editsByDoc, dropped, overrides, failures);
        }

        const command = this.applyTop(top, editsByDoc, dropped, failures);
        const rewritten: RewrittenTarget[] = [];
        const givenUp: GivenUpTarget[] = [];
        for (const plan of plans) {
            if (dropped.has(plan.index)) {
                givenUp.push({
                    target: plan.target,
                    reason: failures.get(plan.index) ?? "dropped",
                });
            } else {
                rewritten.push({
                    target: plan.target,
                    values: resolvedValues(plan.target),
                    env: plan.target.decision.env,
                });
            }
        }
        return {
            command: command ?? top?.text ?? "",
            rewritten,
            givenUp,
            overrides,
        };
    }

    private buildPlans(input: PlanInput, failures: Map<number, string>): TargetPlan[] {
        const plans: TargetPlan[] = [];
        for (let index = 0; index < input.targets.length; index += 1) {
            const target = input.targets[index];
            if (target === undefined) {
                continue;
            }
            const result = align(target.invocation.argv, target.decision.argv);
            if (!result.ok) {
                if (result.unordered) {
                    plans.push({
                        index,
                        target,
                        alignment: undefined,
                        unordered: true,
                    });
                } else {
                    failures.set(index, result.reason);
                }
                continue;
            }
            plans.push({
                index,
                target,
                alignment: result.alignment,
                unordered: false,
            });
        }
        return plans;
    }

    /** Applies binding edits and the per-target word/inline/regenerate plan. */
    private planEdits(
        plan: TargetPlan,
        consumed: Consumed | undefined,
        failures: Map<number, string>,
    ): readonly TextEdit[] | undefined {
        if (plan.alignment === undefined) {
            return this.regenerate(plan, failures);
        }
        const alignment = plan.alignment;
        const gaps = consumed?.gaps ?? new Set<number>();
        const words = consumed?.words ?? new Set<unknown>();
        const wordLevel = planWordLevel(
            plan.target.invocation,
            alignment,
            this.quoter,
            gaps,
        );
        let edits: readonly TextEdit[];
        if (wordLevel.kind === "ok") {
            edits = wordLevel.edits;
        } else {
            const fallback = this.fallback(plan, alignment, words, failures);
            if (fallback === undefined) {
                return undefined;
            }
            edits = fallback;
        }
        const env = planEnv(
            plan.target.invocation,
            plan.target.decision.env,
            this.quoter,
        );
        return env === undefined ? edits : [env, ...edits];
    }

    private regenerate(
        plan: TargetPlan,
        failures: Map<number, string>,
    ): readonly TextEdit[] | undefined {
        const regenerate = planRegenerate(
            plan.target.invocation,
            plan.target.decision.argv,
            this.quoter,
        );
        if (regenerate.kind !== "ok") {
            failures.set(plan.index, regenerate.reason);
            return undefined;
        }
        const env = planEnv(
            plan.target.invocation,
            plan.target.decision.env,
            this.quoter,
        );
        return env === undefined ? regenerate.edits : [env, ...regenerate.edits];
    }

    private fallback(
        plan: TargetPlan,
        alignment: Alignment,
        words: ReadonlySet<unknown>,
        failures: Map<number, string>,
    ): readonly TextEdit[] | undefined {
        const invocation = plan.target.invocation;
        const reps = plan.target.decision.argv;
        const inline = planInline(invocation, reps, alignment, this.quoter, words);
        if (inline.kind === "ok") {
            return inline.edits;
        }
        const regenerate = planRegenerate(invocation, reps, this.quoter);
        if (regenerate.kind !== "ok") {
            failures.set(plan.index, regenerate.reason);
            return undefined;
        }
        return regenerate.edits;
    }

    private evaluateBindings(
        input: PlanInput,
        plans: readonly TargetPlan[],
        consumed: Map<number, Consumed>,
    ): OwnedEdit[] {
        const evaluated = new Set<Binding>();
        const assignments: OwnedEdit[] = [];
        for (const plan of plans) {
            if (plan.alignment === undefined) {
                continue;
            }
            const candidates = bindingWords(plan.target.invocation.argv);
            for (const candidate of candidates) {
                const binding = candidate.binding;
                if (evaluated.has(binding)) {
                    continue;
                }
                evaluated.add(binding);
                const result = this.evaluateBinding(input, plans, candidate.binding);
                if (result === undefined) {
                    continue;
                }
                assignments.push(...result.assignments);
                for (const [owner, item] of result.consumed) {
                    const existing = consumed.get(owner) ?? {
                        gaps: new Set<number>(),
                        words: new Set<unknown>(),
                    };
                    item.gaps.forEach((gap) => existing.gaps.add(gap));
                    item.words.forEach((word) => existing.words.add(word));
                    consumed.set(owner, existing);
                }
            }
        }
        return assignments;
    }

    private evaluateBinding(
        input: PlanInput,
        plans: readonly TargetPlan[],
        binding: Binding,
    ): { assignments: OwnedEdit[]; consumed: Map<number, Consumed> } | undefined {
        const uses = input.interpretation.uses.get(binding) ?? [];
        if (uses.length === 0) {
            return undefined;
        }
        const doc = uses[0]?.doc as ScriptDocument | undefined;
        if (doc === undefined || !uses.every((use) => use.doc === doc)) {
            return undefined;
        }
        const editable = editableValue(binding, doc);
        if (editable === undefined) {
            return undefined;
        }
        const consumed = new Map<number, Consumed>();
        const participants = new Set<number>();
        let proposal: string[] | undefined;
        for (const use of uses) {
            const resolved = this.useProposal(input, plans, use, doc);
            if (resolved === undefined) {
                return undefined;
            }
            participants.add(resolved.owner);
            for (const [owner, item] of resolved.consumed) {
                consumed.set(owner, item);
            }
            if (proposal === undefined) {
                proposal = resolved.items;
            } else if (!sameItems(proposal, resolved.items)) {
                return undefined;
            }
        }
        if (proposal === undefined || proposal.length === 0) {
            return undefined;
        }
        if (!proposal.every((item) => splitSafe(item))) {
            return undefined;
        }
        const value = proposal.join(" ");
        const text = renderValue(value, editable.style, this.quoter);
        const owners = [...participants].sort((left, right) => left - right);
        return {
            assignments: [
                {
                    edit: { doc, start: editable.start, end: editable.end, text },
                    owners,
                },
            ],
            consumed,
        };
    }

    private useProposal(
        input: PlanInput,
        plans: readonly TargetPlan[],
        use: BindingUse,
        doc: ScriptDocument,
    ): { owner: number; items: string[]; consumed: Map<number, Consumed> } | undefined {
        if (use.doc !== doc || use.site.kind !== "argv") {
            return undefined;
        }
        const owner = input.ownerOf.get(use.site.invocation);
        if (owner === undefined) {
            return undefined;
        }
        const plan = plans.find((candidate) => candidate.index === owner);
        if (plan === undefined || plan.alignment === undefined) {
            return undefined;
        }
        const alignment = plan.alignment;
        const invocation = plan.target.invocation;
        const offset = use.site.invocation.offset;
        const fields = use.site.argIndexes
            .filter((index) => index >= offset)
            .map((index) => index - offset);
        const word = fields[0];
        if (word === undefined) {
            return undefined;
        }
        const wordRef = invocation.argv[word]?.word;
        if (wordRef === undefined) {
            return undefined;
        }
        const fieldIndices: number[] = [];
        for (let index = 0; index < invocation.argv.length; index += 1) {
            if (invocation.argv[index]?.word === wordRef) {
                fieldIndices.push(index);
            }
        }
        if (!fieldIndices.every((field) => alignment.repOfAnchor.has(field))) {
            return undefined;
        }
        const gapIndices = consumedGaps(alignment, fieldIndices);
        if (gapIndices === undefined) {
            return undefined;
        }
        const window = windowValues(
            invocation.argv,
            plan.target.decision.argv,
            alignment,
            fieldIndices,
        );
        if (window === undefined) {
            return undefined;
        }
        return {
            owner,
            items: [...window.items],
            consumed: new Map([
                [owner, { gaps: new Set(gapIndices), words: new Set([wordRef]) }],
            ]),
        };
    }

    private mapDocument(
        doc: ScriptDocument,
        editsByDoc: Map<ScriptDocument, OwnedEdit[]>,
        dropped: Set<number>,
        overrides: Map<Invocation, Map<number, string | undefined>>,
        failures: Map<number, string>,
    ): void {
        const list = (editsByDoc.get(doc) ?? []).filter((item) =>
            item.owners.every((owner) => !dropped.has(owner)),
        );
        if (list.length === 0) {
            return;
        }
        const { kept, dropped: conflicts } = resolveConflicts(list);
        for (const owner of conflicts) {
            dropped.add(owner);
            failures.set(owner, "edit conflict");
        }
        if (kept.length === 0) {
            return;
        }
        const keptEdits = kept.map((item) => item.edit);
        const newText = applyEdits(doc.text, keptEdits);
        if (newText === undefined) {
            this.dropAll(kept, dropped, failures);
            return;
        }
        const mapped = mapNested(doc, keptEdits, newText, this.quoter);
        // eslint-disable-next-line sonarjs/in-operator-type-error
        if ("error" in mapped) {
            this.dropAll(kept, dropped, failures, mapped.error);
            return;
        }
        const parent = doc.parent?.doc as ScriptDocument | undefined;
        if (parent === undefined) {
            return;
        }
        const owners = unionOwners(kept);
        for (const edit of mapped.edits) {
            pushEdit(editsByDoc, { edit, owners });
        }
        if (mapped.override !== undefined) {
            recordOverride(overrides, mapped.override);
        }
    }

    private dropAll(
        kept: readonly OwnedEdit[],
        dropped: Set<number>,
        failures: Map<number, string>,
        reason = "nested edit could not be applied",
    ): void {
        for (const item of kept) {
            for (const owner of item.owners) {
                dropped.add(owner);
                failures.set(owner, reason);
            }
        }
    }

    private applyTop(
        top: ScriptDocument | undefined,
        editsByDoc: Map<ScriptDocument, OwnedEdit[]>,
        dropped: Set<number>,
        failures: Map<number, string>,
    ): string | undefined {
        if (top === undefined) {
            return undefined;
        }
        const list = (editsByDoc.get(top) ?? []).filter((item) =>
            item.owners.every((owner) => !dropped.has(owner)),
        );
        const { kept, dropped: conflicts } = resolveConflicts(list);
        for (const owner of conflicts) {
            dropped.add(owner);
            failures.set(owner, "edit conflict");
        }
        return applyEdits(
            top.text,
            kept.map((item) => item.edit),
        );
    }
}

function resolvedValues(target: RewriteTarget): readonly (string | undefined)[] {
    return target.decision.argv.map((replacement) =>
        replacement.kind === "text"
            ? replacement.value
            : target.invocation.argv[replacement.index]?.value,
    );
}

function planEnv(
    invocation: Invocation,
    env: Readonly<Record<string, string>>,
    quoter: ShellQuoter,
): TextEdit | undefined {
    const entries = Object.entries(env);
    const first = invocation.argv[0];
    if (entries.length === 0 || first === undefined) {
        return undefined;
    }
    const assignments = entries
        .map(([name, value]) => `${name}=${quoter.quote(value)}`)
        .join(" ");
    const text =
        invocation.wrappers.length > 0 ? `env ${assignments} ` : `${assignments} `;
    return {
        doc: invocation.doc,
        start: first.word.span.start,
        end: first.word.span.start,
        text,
    };
}

function consumedGaps(
    alignment: Alignment,
    fieldIndices: readonly number[],
): number[] | undefined {
    const out: number[] = [];
    const first = fieldIndices[0];
    if (first === undefined) {
        return undefined;
    }
    const before = gapIndex(alignment, undefined, first);
    const beforeGap = before === undefined ? undefined : alignment.gaps[before];
    if (beforeGap !== undefined && beforeGap.deleted.length > 0) {
        return undefined;
    }
    if (before !== undefined) {
        out.push(before);
    }
    for (let index = 1; index < fieldIndices.length; index += 1) {
        const previous = fieldIndices[index - 1] as number;
        const current = fieldIndices[index] as number;
        const betweenIndex = gapIndex(alignment, previous, current);
        const between =
            betweenIndex === undefined ? undefined : alignment.gaps[betweenIndex];
        if (between === undefined || between.deleted.length > 0) {
            return undefined;
        }
        out.push(betweenIndex as number);
    }
    return out;
}

function sameItems(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((v, i) => v === right[i]);
}

function depth(doc: ScriptDocument): number {
    let current = doc.parent?.doc;
    let count = 0;
    while (current !== undefined) {
        count += 1;
        current = current.parent?.doc;
    }
    return count;
}

function resolveConflicts(list: readonly OwnedEdit[]): {
    kept: OwnedEdit[];
    dropped: number[];
} {
    const sorted = [...list].sort(
        (left, right) =>
            left.edit.start - right.edit.start || left.edit.end - right.edit.end,
    );
    const dropped = new Set<number>();
    const kept: OwnedEdit[] = [];
    let cursor = -1;
    for (const item of sorted) {
        if (item.edit.start < cursor) {
            for (const owner of item.owners) {
                dropped.add(owner);
            }
            continue;
        }
        kept.push(item);
        cursor = Math.max(cursor, item.edit.end);
    }
    const final = kept.filter((item) =>
        item.owners.every((owner) => !dropped.has(owner)),
    );
    return { kept: final, dropped: [...dropped] };
}

function unionOwners(list: readonly OwnedEdit[]): number[] {
    const owners = new Set<number>();
    for (const item of list) {
        for (const owner of item.owners) {
            owners.add(owner);
        }
    }
    return [...owners].sort((left, right) => left - right);
}

function pushEdit(
    editsByDoc: Map<ScriptDocument, OwnedEdit[]>,
    owned: OwnedEdit,
): void {
    const list = editsByDoc.get(owned.edit.doc);
    if (list === undefined) {
        editsByDoc.set(owned.edit.doc, [owned]);
    } else {
        list.push(owned);
    }
}

function recordOverride(
    overrides: Map<Invocation, Map<number, string | undefined>>,
    override: { invocation: Invocation; index: number; value: string },
): void {
    const existing =
        overrides.get(override.invocation) ?? new Map<number, string | undefined>();
    existing.set(override.index, override.value);
    overrides.set(override.invocation, existing);
}
