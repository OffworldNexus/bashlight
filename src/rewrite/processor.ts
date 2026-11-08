/* eslint-disable sonarjs/function-return-type */
/**
 * The composition root's engine: runs the rules over every invocation of a
 * command, groups the ones that share a source node, asks the rewriter to plan
 * edits, then validates the result before handing it back. It never throws: any
 * internal failure yields `unchanged`.
 */

import type { Interpreter } from "../interp/interpreter.ts";
import type { Invocation } from "../interp/invocation.ts";
import type { InitialState } from "../interp/session.ts";
import type { Change, CommandProcessor, Outcome, ProcessRequest } from "../outcome.ts";
import type { ProjectInspector } from "../project/project-inspector.ts";
import type { ScriptInspector } from "../project/script-inspector.ts";
import type { RuleContext } from "../rules/rule.ts";
import type { Decision, RuleEngine } from "../rules/rule-engine.ts";
import { isSubmitted, toCommandCall } from "./call-builder.ts";
import type { RewriteTarget, RewrittenTarget } from "./rewriter.ts";
import { Rewriter } from "./rewriter.ts";
import { ShellQuoter } from "./shell-quoter.ts";
import { type ExpectedInvocation, validate } from "./validator.ts";

export interface Inspectors {
    readonly project: ProjectInspector;
    readonly scripts: ScriptInspector;
}

export interface ProcessorDependencies {
    readonly interpreter: Interpreter;
    readonly engine: RuleEngine;
    readonly rewriter: Rewriter;
    /** Fresh inspectors for one request; they memoize per request. */
    readonly inspectors: () => Inspectors;
}

export class CommandProcessorImpl implements CommandProcessor {
    private readonly quoter = new ShellQuoter();

    constructor(private readonly dependencies: ProcessorDependencies) {}

    process(request: ProcessRequest): Outcome {
        try {
            return this.run(request);
        } catch (error) {
            return {
                kind: "unchanged",
                reason: `internal error: ${message(error)}`,
            };
        }
    }

    private run(request: ProcessRequest): Outcome {
        const initial: InitialState = {
            cwd: request.cwd,
            variables: request.env,
            complete: true,
        };
        const interpretation = this.dependencies.interpreter.interpret(
            request.command,
            initial,
        );
        if (!interpretation.parse.ok) {
            return { kind: "unchanged", reason: "the command did not parse" };
        }
        if (interpretation.truncated) {
            return { kind: "unchanged", reason: "the command was too large" };
        }
        const inspectors = this.dependencies.inspectors();
        const decisions = new Map<Invocation, Decision>();
        const blockedMessages: string[] = [];
        const blockedRuleIds = new Set<string>();
        for (const invocation of interpretation.invocations) {
            if (!isSubmitted(invocation)) {
                continue;
            }
            const decision = this.dependencies.engine.decide(
                toCommandCall(invocation),
                contextFor(invocation, inspectors),
            );
            if (decision.kind === "block" && !invocation.speculative) {
                blockedMessages.push(decision.message);
                blockedRuleIds.add(decision.ruleId);
            }
            decisions.set(
                invocation,
                decision.kind === "block" && invocation.speculative
                    ? { kind: "keep" }
                    : decision,
            );
        }
        const firstBlock = blockedMessages[0];
        if (firstBlock !== undefined) {
            return {
                kind: "blocked",
                message: firstBlock,
                ruleIds: [...blockedRuleIds],
            };
        }

        const grouped = this.group(interpretation.invocations, decisions);
        const plan = this.dependencies.rewriter.plan({
            interpretation,
            targets: grouped.targets,
            ownerOf: grouped.ownerOf,
        });
        if (plan.rewritten.length === 0) {
            return unchanged(nothingReason(plan) ?? grouped.conflicts[0]);
        }
        const expected = buildExpected(interpretation, plan, grouped.ownerOf);
        const rewritten = this.dependencies.interpreter.interpret(
            plan.command,
            initial,
        );
        const check = validate(rewritten, expected);
        if (!check.ok) {
            return {
                kind: "unchanged",
                reason: `validation failed: ${check.reason}`,
            };
        }
        if (plan.command === request.command) {
            return unchanged(nothingReason(plan) ?? grouped.conflicts[0]);
        }
        return {
            kind: "rewritten",
            command: plan.command,
            changes: plan.rewritten.map((target) => this.change(target)),
        };
    }

    private group(
        invocations: readonly Invocation[],
        decisions: ReadonlyMap<Invocation, Decision>,
    ): {
        targets: RewriteTarget[];
        ownerOf: Map<Invocation, number>;
        conflicts: string[];
    } {
        const nodes = new Map<Invocation["command"], Invocation[]>();
        for (const invocation of invocations) {
            if (!isSubmitted(invocation) || !decisions.has(invocation)) {
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
            const resolved = group.map((invocation) => ({
                invocation,
                decision: decisions.get(invocation) as Decision,
            }));
            const first = resolved[0];
            if (first === undefined) {
                continue;
            }
            const reference = first.decision;
            if (reference.kind !== "replace") {
                continue;
            }
            const consistent = resolved.every(
                (item) =>
                    item.decision.kind === "replace" &&
                    sameDecision(reference, item.decision, item.invocation),
            );
            if (!consistent) {
                conflicts.push("a command that runs twice would change differently");
                continue;
            }
            const index = targets.length;
            targets.push({ invocation: first.invocation, decision: reference });
            for (const item of resolved) {
                ownerOf.set(item.invocation, index);
            }
        }
        return { targets, ownerOf, conflicts };
    }

    private change(target: RewrittenTarget): Change {
        const ruleIds: string[] = [];
        const reasons: string[] = [];
        for (const applied of target.target.decision.applied) {
            ruleIds.push(applied.ruleId);
            reasons.push(applied.reason);
        }
        return {
            ruleIds,
            reasons,
            before: this.display(target.target.invocation.argv.map((arg) => arg.value)),
            after: this.display(target.values),
        };
    }

    private display(values: readonly (string | undefined)[]): string {
        return values
            .map((value) =>
                value === undefined ? "<unknown>" : this.quoter.quote(value),
            )
            .join(" ");
    }
}

function contextFor(invocation: Invocation, inspectors: Inspectors): RuleContext {
    return {
        cwd: invocation.context.cwd,
        host: invocation.context.host,
        project: inspectors.project,
        scripts: inspectors.scripts,
    };
}

function sameDecision(
    reference: Extract<Decision, { kind: "replace" }>,
    other: Decision,
    invocation: Invocation,
): boolean {
    if (other.kind !== "replace") {
        return false;
    }
    if (!sameRecord(reference.env, other.env)) {
        return false;
    }
    const left = resolve(reference, invocation);
    const right = resolve(other, invocation);
    return left.length === right.length && left.every((value, i) => value === right[i]);
}

function resolve(
    decision: Extract<Decision, { kind: "replace" }>,
    invocation: Invocation,
): (string | undefined)[] {
    return decision.argv.map((replacement) =>
        replacement.kind === "text"
            ? replacement.value
            : invocation.argv[replacement.index]?.value,
    );
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

function buildExpected(
    interpretation: {
        readonly invocations: readonly Invocation[];
    },
    plan: {
        readonly rewritten: readonly RewrittenTarget[];
        readonly overrides: ReadonlyMap<
            Invocation,
            ReadonlyMap<number, string | undefined>
        >;
        readonly givenUp: readonly { readonly target: RewriteTarget }[];
    },
    ownerOf: ReadonlyMap<Invocation, number>,
): ExpectedInvocation[] {
    const rewritten = new Map<number, RewrittenTarget>();
    for (const target of plan.rewritten) {
        const index = ownerOf.get(target.target.invocation);
        if (index !== undefined) {
            rewritten.set(index, target);
        }
    }
    const expected: ExpectedInvocation[] = [];
    for (const invocation of interpretation.invocations) {
        const index = ownerOf.get(invocation);
        const target = index === undefined ? undefined : rewritten.get(index);
        if (target !== undefined) {
            expected.push({
                kind: invocation.kind,
                argv: target.values,
                cwd: invocation.context.cwd,
                host: invocation.context.host,
                env: target.env,
            });
            continue;
        }
        expected.push({
            kind: invocation.kind,
            argv: withOverrides(invocation, plan.overrides.get(invocation)),
            cwd: invocation.context.cwd,
            host: invocation.context.host,
            env: {},
        });
    }
    return expected;
}

function withOverrides(
    invocation: Invocation,
    overrides: ReadonlyMap<number, string | undefined> | undefined,
): readonly (string | undefined)[] {
    const values = invocation.argv.map((arg) => arg.value);
    if (overrides === undefined) {
        return values;
    }
    for (const [fullIndex, value] of overrides) {
        const index = fullIndex - invocation.offset;
        if (index >= 0 && index < values.length) {
            values[index] = value;
        }
    }
    return values;
}

function nothingReason(plan: {
    readonly givenUp: readonly { readonly reason: string }[];
}): string | undefined {
    return plan.givenUp[0]?.reason;
}

function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function unchanged(reason: string | undefined): Outcome {
    return reason === undefined ? { kind: "unchanged" } : { kind: "unchanged", reason };
}
