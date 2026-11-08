/**
 * Orchestrates rewriting: aligns each decision with its invocation, plans the
 * most surgical edits (word level → inline → regenerate), folds variable uses
 * back into their assignments, maps nested documents bottom-up, resolves edit
 * conflicts and returns the new top-level command.
 *
 * The rewriter never validates; that is the validator's job, so a buggy plan
 * can never change a command that fails the round-trip check. The per-plan
 * state lives in `PlanSession`; this class only carries the collaborators.
 */

import type { Interpretation } from "../interp/interpreter.ts";
import type { Invocation } from "../interp/invocation.ts";
import type { Decision } from "../rules/rule-engine.ts";
import type { ValueOverride } from "./nested.ts";
import { PlanSession } from "./plan-session.ts";
import type { ShellQuoter } from "./shell-quoter.ts";
import { createStrategies, type RewriteStrategy } from "./strategies.ts";

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
    readonly overrides: ReadonlyMap<Invocation, readonly ValueOverride[]>;
    /** Variable values an intended binding fold changes, for the validator. */
    readonly bindingValues: ReadonlyMap<
        string,
        { readonly from: string; readonly to: string }
    >;
}

export interface PlanInput {
    readonly interpretation: Interpretation;
    readonly targets: readonly RewriteTarget[];
    /** Every invocation that belongs to a target (a node can run several times). */
    readonly ownerOf: ReadonlyMap<Invocation, number>;
}

export class Rewriter {
    private readonly strategies: readonly RewriteStrategy[];

    constructor(
        private readonly quoter: ShellQuoter,
        strategies: readonly RewriteStrategy[] = createStrategies(),
    ) {
        this.strategies = strategies;
    }

    plan(input: PlanInput): PlanResult {
        return new PlanSession(input, this.quoter, this.strategies).run();
    }
}
