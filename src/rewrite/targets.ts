/**
 * Groups the invocations of a command by source node and turns the consistent
 * ones into rewrite targets. Several invocations can come from the same
 * `SimpleCommand` (a function called twice, a speculative walk); when they
 * would change differently the node is left alone.
 */

import type { Invocation } from "../interp/invocation.ts";
import type { Decision } from "../rules/rule-engine.ts";
import { sameValues } from "../shared/guards.ts";
import { resolveValues } from "./resolve.ts";
import type { RewriteTarget } from "./rewriter.ts";

export interface GroupedTargets {
    readonly targets: RewriteTarget[];
    readonly ownerOf: Map<Invocation, number>;
    readonly conflicts: string[];
}

export function groupTargets(
    invocations: readonly Invocation[],
    decisions: ReadonlyMap<Invocation, Decision>,
): GroupedTargets {
    const nodes = new Map<Invocation["command"], Invocation[]>();
    for (const invocation of invocations) {
        if (!decisions.has(invocation)) {
            continue;
        }
        const list = nodes.get(invocation.command);
        if (list === undefined) {
            nodes.set(invocation.command, [invocation]);
        } else {
            list.push(invocation);
        }
    }
    const targets: RewriteTarget[] = [];
    const ownerOf = new Map<Invocation, number>();
    const conflicts: string[] = [];
    for (const group of nodes.values()) {
        const first = group[0];
        if (first === undefined) {
            continue;
        }
        const reference = decisions.get(first);
        if (reference === undefined || reference.kind !== "replace") {
            continue;
        }
        const consistent = group.every((invocation) => {
            const decision = decisions.get(invocation);
            return (
                decision !== undefined &&
                decision.kind === "replace" &&
                sameDecision(reference, decision, invocation)
            );
        });
        if (!consistent) {
            conflicts.push("a command that runs twice would change differently");
            continue;
        }
        const index = targets.length;
        targets.push({ invocation: first, decision: reference });
        for (const invocation of group) {
            ownerOf.set(invocation, index);
        }
    }
    return { targets, ownerOf, conflicts };
}

function sameDecision(
    reference: Extract<Decision, { kind: "replace" }>,
    other: Extract<Decision, { kind: "replace" }>,
    invocation: Invocation,
): boolean {
    if (!sameRecord(reference.env, other.env)) {
        return false;
    }
    const left = resolveValues(invocation.argv, reference.argv);
    const right = resolveValues(invocation.argv, other.argv);
    return sameValues(left, right);
}

function sameRecord(
    left: Readonly<Record<string, string>>,
    right: Readonly<Record<string, string>>,
): boolean {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return (
        leftKeys.length === rightKeys.length &&
        leftKeys.every((key) => left[key] === right[key])
    );
}
