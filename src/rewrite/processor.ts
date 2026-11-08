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
import type { FileSystem } from "../project/file-system.ts";
import type { ProjectInspector } from "../project/project-inspector.ts";
import type { ScriptInspector } from "../project/script-inspector.ts";
import type { Rule, RuleContext } from "../rules/rule.ts";
import {
    type Decision,
    NoopRuleErrorSink,
    RuleEngine,
    type RuleErrorSink,
} from "../rules/rule-engine.ts";
import { isSubmitted, toCommandCall } from "./call-builder.ts";
import { buildExpected } from "./expected.ts";
import type { RewrittenTarget } from "./rewriter.ts";
import { Rewriter } from "./rewriter.ts";
import { ShellQuoter } from "./shell-quoter.ts";
import { groupTargets } from "./targets.ts";
import { validate } from "./validator.ts";

export interface Inspectors {
    readonly project: ProjectInspector;
    readonly scripts: ScriptInspector;
    readonly files: FileSystem;
}

export interface ProcessorDependencies {
    readonly interpreter: Interpreter;
    /** The rules in effect for one project directory (custom first). */
    readonly rulesFor: (directory: string) => readonly Rule[];
    readonly rewriter: Rewriter;
    /** Fresh inspectors for one request; they memoize per request. */
    readonly inspectors: () => Inspectors;
    readonly quoter: ShellQuoter;
    /** Where rules report unexpected exceptions (fail-open). */
    readonly ruleErrors?: RuleErrorSink;
}

const NOOP_ERROR_SINK = new NoopRuleErrorSink();

export class CommandProcessorImpl implements CommandProcessor {
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
        const engine = this.engineFor(request.projectDir ?? request.cwd);
        const decisions = new Map<Invocation, Decision>();
        const blockedMessages: string[] = [];
        const blockedRuleIds = new Set<string>();
        for (const invocation of interpretation.invocations) {
            if (!isSubmitted(invocation)) {
                continue;
            }
            const decision = engine.decide(
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

        const grouped = groupTargets(interpretation.invocations, decisions);
        const plan = this.dependencies.rewriter.plan({
            interpretation,
            targets: grouped.targets,
            ownerOf: grouped.ownerOf,
        });
        if (plan.rewritten.length === 0) {
            return unchanged(nothingReason(plan) ?? grouped.conflicts[0]);
        }
        const expected = buildExpected({
            interpretation,
            plan,
            ownerOf: grouped.ownerOf,
        });
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

    /** Builds the engine for this directory's rules (cheap: an array holder). */
    private engineFor(directory: string): RuleEngine {
        return new RuleEngine(
            this.dependencies.rulesFor(directory),
            {},
            this.dependencies.ruleErrors ?? NOOP_ERROR_SINK,
        );
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
                value === undefined
                    ? "<unknown>"
                    : this.dependencies.quoter.quote(value),
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
        files: inspectors.files,
    };
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
