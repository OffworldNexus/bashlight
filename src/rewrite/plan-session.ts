/* eslint-disable sonarjs/cognitive-complexity, sonarjs/function-return-type */
/**
 * Per-plan mutable state and orchestration. A `PlanSession` owns the plans,
 * failures, consumed gaps/words, edits per document, value overrides and the
 * dropped-owner set; the `BindingFolder` collaborator folds variable uses back
 * into their assignments; the strategies plan each target's edits.
 */

import type { Binding, BindingUse } from "../interp/binding.ts";
import type { ScriptDocument } from "../interp/documents.ts";
import { parentDocument } from "../interp/documents.ts";
import type { Invocation } from "../interp/invocation.ts";
import { fragmentsValue } from "../interp/values.ts";
import { indexRange } from "../rules/verdict.ts";
import type { Alignment } from "./alignment.ts";
import { align, gapIndex } from "./alignment.ts";
import { bindingWords, editableValue, renderValue, splitSafe } from "./binding-edit.ts";
import { toArgvIndex } from "./call-builder.ts";
import { CommandPlanner, windowValues } from "./command-planner.ts";
import { mapNested, type ValueOverride } from "./nested.ts";
import { resolveValues } from "./resolve.ts";
import type {
    GivenUpTarget,
    PlanInput,
    PlanResult,
    RewriteTarget,
    RewrittenTarget,
} from "./rewriter.ts";
import type { ShellQuoter } from "./shell-quoter.ts";
import type { RewriteStrategy } from "./strategies.ts";
import { applyEdits, type TextEdit } from "./text-edit.ts";
import { wordRuns } from "./word-runs.ts";

export interface OwnedEdit {
    readonly edit: TextEdit;
    readonly owners: readonly number[];
}

interface TargetPlan {
    readonly index: number;
    readonly target: RewriteTarget;
    readonly alignment: Alignment | undefined;
}

interface Consumed {
    readonly gaps: Set<number>;
    readonly words: Set<unknown>;
}

interface FoldedBinding {
    readonly assignments: OwnedEdit[];
    readonly folded: Map<string, { from: string; to: string }>;
}

export class PlanSession {
    private readonly failures = new Map<number, string>();
    private readonly consumed = new Map<number, Consumed>();
    private readonly editsByDoc = new Map<ScriptDocument, OwnedEdit[]>();
    private readonly overrides = new Map<Invocation, ValueOverride[]>();
    private dropped = new Set<number>();
    private readonly plans: TargetPlan[];
    private readonly assignments: OwnedEdit[] = [];
    private readonly folded = new Map<string, { from: string; to: string }>();
    private readonly bindings: BindingFolder;

    constructor(
        private readonly input: PlanInput,
        private readonly quoter: ShellQuoter,
        private readonly strategies: readonly RewriteStrategy[],
    ) {
        this.plans = this.buildPlans();
        this.bindings = new BindingFolder(input, this.plans, quoter);
    }

    run(): PlanResult {
        const result = this.bindings.fold(this.consumed);
        this.assignments.push(...result.assignments);
        for (const [name, value] of result.folded) {
            this.folded.set(name, value);
        }

        for (const plan of this.plans) {
            const edits = this.planEdits(plan);
            if (edits !== undefined) {
                for (const edit of edits) {
                    this.addEdit(edit, [plan.index]);
                }
            }
        }
        for (const assignment of this.assignments) {
            this.addEdit(assignment.edit, assignment.owners);
        }
        this.dropped = new Set(this.failures.keys());
        for (const assignment of this.assignments) {
            if (assignment.owners.some((owner) => this.dropped.has(owner))) {
                for (const owner of assignment.owners) {
                    this.dropped.add(owner);
                    this.failures.set(owner, "a shared binding edit was dropped");
                }
            }
        }

        const top = this.input.interpretation.documents[0];
        const nested = this.input.interpretation.documents
            .filter((doc) => doc !== top)
            .sort((left, right) => depth(right) - depth(left));
        for (const doc of nested) {
            this.mapDocument(doc);
        }
        const command = this.applyTop(top);

        const rewritten: RewrittenTarget[] = [];
        const givenUp: GivenUpTarget[] = [];
        for (const plan of this.plans) {
            if (this.dropped.has(plan.index)) {
                givenUp.push({
                    target: plan.target,
                    reason: this.failures.get(plan.index) ?? "dropped",
                });
            } else {
                rewritten.push({
                    target: plan.target,
                    values: resolveValues(
                        plan.target.invocation.argv,
                        plan.target.decision.argv,
                    ),
                    env: plan.target.decision.env,
                });
            }
        }
        return {
            command: command ?? top?.text ?? "",
            rewritten,
            givenUp,
            overrides: this.overrides,
            bindingValues: this.folded,
        };
    }

    private buildPlans(): TargetPlan[] {
        const plans: TargetPlan[] = [];
        for (let index = 0; index < this.input.targets.length; index += 1) {
            const target = this.input.targets[index];
            if (target === undefined) {
                continue;
            }
            const result = align(target.invocation.argv, target.decision.argv);
            if (!result.ok) {
                if (result.unordered) {
                    plans.push({ index, target, alignment: undefined });
                } else {
                    this.failures.set(index, result.reason);
                }
                continue;
            }
            plans.push({ index, target, alignment: result.alignment });
        }
        return plans;
    }

    private planEdits(plan: TargetPlan): readonly TextEdit[] | undefined {
        const consumed = this.consumed.get(plan.index);
        const input = {
            planner: new CommandPlanner(plan.target.invocation, this.quoter),
            alignment: plan.alignment,
            replacements: plan.target.decision.argv,
            gaps: consumed?.gaps ?? new Set<number>(),
            words: consumed?.words ?? new Set<unknown>(),
        };
        let edits: readonly TextEdit[] | undefined;
        let reason = "no strategy could express the change";
        for (const strategy of this.strategies) {
            const result = strategy.plan(input);
            if (result === undefined) {
                continue;
            }
            if (result.kind === "ok") {
                edits = result.edits;
                break;
            }
            reason = result.reason;
        }
        if (edits === undefined) {
            this.failures.set(plan.index, reason);
            return undefined;
        }
        const env = planEnv(
            plan.target.invocation,
            plan.target.decision.env,
            this.quoter,
        );
        return env === undefined ? edits : [env, ...edits];
    }

    private addEdit(edit: TextEdit, owners: readonly number[]): void {
        const list = this.editsByDoc.get(edit.doc);
        if (list === undefined) {
            this.editsByDoc.set(edit.doc, [{ edit, owners }]);
        } else {
            list.push({ edit, owners });
        }
    }

    private mapDocument(doc: ScriptDocument): void {
        const kept = this.resolveFor(doc);
        if (kept.length === 0) {
            return;
        }
        const keptEdits = kept.map((item) => item.edit);
        const newText = applyEdits(doc.text, keptEdits);
        if (newText === undefined) {
            this.dropAll(kept);
            return;
        }
        const mapped = mapNested(doc, keptEdits, newText, this.quoter);
        if (mapped.kind === "error") {
            this.dropAll(kept, mapped.reason);
            return;
        }
        const parent = parentDocument(doc);
        if (parent === undefined) {
            return;
        }
        const owners = unionOwners(kept);
        for (const edit of mapped.edits) {
            this.addEdit(edit, owners);
        }
        for (const override of mapped.overrides) {
            this.recordOverride(override);
        }
    }

    private resolveFor(doc: ScriptDocument): OwnedEdit[] {
        const list = (this.editsByDoc.get(doc) ?? []).filter((item) =>
            item.owners.every((owner) => !this.dropped.has(owner)),
        );
        if (list.length === 0) {
            return [];
        }
        const { kept, dropped } = resolveConflicts(list);
        for (const owner of dropped) {
            this.dropped.add(owner);
            this.failures.set(owner, "edit conflict");
        }
        return kept;
    }

    private dropAll(kept: readonly OwnedEdit[], reason?: string): void {
        for (const item of kept) {
            for (const owner of item.owners) {
                this.dropped.add(owner);
                if (reason !== undefined) {
                    this.failures.set(owner, reason);
                } else {
                    this.failures.set(owner, "nested edit could not be applied");
                }
            }
        }
    }

    private applyTop(top: ScriptDocument | undefined): string | undefined {
        if (top === undefined) {
            return undefined;
        }
        const kept = this.resolveFor(top);
        return applyEdits(
            top.text,
            kept.map((item) => item.edit),
        );
    }

    private recordOverride(override: ValueOverride): void {
        const existing = this.overrides.get(override.invocation);
        if (existing === undefined) {
            this.overrides.set(override.invocation, [override]);
        } else {
            existing.push(override);
        }
    }
}

/** Folds every eligible variable use back into the assignment that sets it. */
export class BindingFolder {
    constructor(
        private readonly input: PlanInput,
        private readonly plans: readonly TargetPlan[],
        private readonly quoter: ShellQuoter,
    ) {}

    fold(consumed: Map<number, Consumed>): FoldedBinding {
        const evaluated = new Set<Binding>();
        const assignments: OwnedEdit[] = [];
        const folded = new Map<string, { from: string; to: string }>();
        for (const plan of this.plans) {
            if (plan.alignment === undefined) {
                continue;
            }
            for (const candidate of bindingWords(plan.target.invocation.argv)) {
                const binding = candidate.binding;
                if (evaluated.has(binding)) {
                    continue;
                }
                evaluated.add(binding);
                const result = this.evaluate(binding);
                if (result === undefined) {
                    continue;
                }
                assignments.push(...result.assignments);
                if (result.folded !== undefined) {
                    folded.set(binding.name, result.folded);
                }
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
        return { assignments, folded };
    }

    private evaluate(binding: Binding):
        | {
              assignments: OwnedEdit[];
              consumed: Map<number, Consumed>;
              folded: { from: string; to: string } | undefined;
          }
        | undefined {
        const uses = this.input.interpretation.uses.get(binding) ?? [];
        const doc = binding.doc;
        if (doc === undefined || uses.length === 0) {
            return undefined;
        }
        if (!uses.every((use) => use.doc === doc)) {
            return undefined;
        }
        const editable = editableValue(binding);
        if (editable === undefined) {
            return undefined;
        }
        const consumed = new Map<number, Consumed>();
        const participants = new Set<number>();
        let proposal: string[] | undefined;
        for (const use of uses) {
            const resolved = this.useProposal(use, doc);
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
        const from = fragmentsValue(binding.value);
        return {
            assignments: [
                {
                    edit: { doc, start: editable.start, end: editable.end, text },
                    owners,
                },
            ],
            consumed,
            folded: from === undefined ? undefined : { from, to: value },
        };
    }

    private useProposal(
        use: BindingUse,
        doc: ScriptDocument,
    ): { owner: number; items: string[]; consumed: Map<number, Consumed> } | undefined {
        if (use.doc !== doc || use.site.kind !== "argv") {
            return undefined;
        }
        const site = use.site;
        const owner = this.input.ownerOf.get(site.invocation);
        if (owner === undefined) {
            return undefined;
        }
        const plan = this.plans.find((candidate) => candidate.index === owner);
        if (plan === undefined || plan.alignment === undefined) {
            return undefined;
        }
        const alignment = plan.alignment;
        const invocation = plan.target.invocation;
        const fields = site.argIndexes
            .filter((index) => index >= site.invocation.offset)
            .map((index) => toArgvIndex(site.invocation, index));
        const word = fields[0];
        if (word === undefined) {
            return undefined;
        }
        const wordRef = invocation.argv[word]?.word;
        if (wordRef === undefined) {
            return undefined;
        }
        const run = wordRuns(invocation.argv).find((item) => item.word === wordRef);
        if (run === undefined) {
            return undefined;
        }
        const fieldIndices = indexRange(run.start, run.end);
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
