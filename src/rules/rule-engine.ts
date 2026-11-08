/* eslint-disable sonarjs/cognitive-complexity, sonarjs/function-return-type */
/**
 * Applies rules to one command until they stop changing it.
 *
 * The engine owns the fixpoint loop: it feeds each `replace` verdict back into
 * the rules on a new argv, composes the replacements so the final decision is
 * still expressed in terms of the *original* arguments, and stops when a round
 * keeps, a cycle appears, or a round budget is spent. A `block` anywhere wins.
 */
import type { EnvironmentView } from "../interp/context.ts";
import type {
    CallArg,
    CommandCall,
    Replacement,
    Rule,
    RuleContext,
    Verdict,
} from "./rule.ts";
import { ReplacementResolver } from "./verdict.ts";

/** One rule that changed the command, in the order it applied. */
export interface AppliedRule {
    readonly ruleId: string;
    readonly reason: string;
}

/** Outcome of running every rule to a fixpoint. */
export type Decision =
    | { readonly kind: "keep" }
    | {
          readonly kind: "replace";
          /** New argv, in terms of the original call's indices. */
          readonly argv: readonly Replacement[];
          /** Accumulated environment injections. */
          readonly env: Readonly<Record<string, string>>;
          readonly applied: readonly AppliedRule[];
      }
    | { readonly kind: "block"; readonly ruleId: string; readonly message: string };

/** A rule that threw while inspecting a command. */
export interface RuleFailure {
    readonly ruleId: string;
    readonly error: unknown;
}

/**
 * Where rules report unexpected exceptions. Injecting it keeps the engine free
 * of console access and lets the composition root wire logging.
 */
export interface RuleErrorSink {
    report(failure: RuleFailure): void;
}

/** Default sink: swallow failures (bashlight fails open). */
export class NoopRuleErrorSink implements RuleErrorSink {
    report(): void {
        // A rule never breaks a command: the failure is dropped.
    }
}

export interface RuleEngineOptions {
    /** Maximum number of replace rounds before giving up. Defaults to 8. */
    readonly maxRounds?: number;
}

const DEFAULT_MAX_ROUNDS = 8;

/** `EnvironmentView` that overlays injected variables over a base view. */
class OverlayEnvironment implements EnvironmentView {
    constructor(
        private readonly base: EnvironmentView,
        private readonly overlay: Readonly<Record<string, string>>,
    ) {}

    lookup(name: string) {
        if (Object.hasOwn(this.overlay, name)) {
            return { kind: "set" as const, value: this.overlay[name] ?? "" };
        }
        return this.base.lookup(name);
    }
}

/** The verdict of a round, with the id of the rule that produced it. */
interface RoundOutcome {
    readonly verdict: Verdict;
    readonly ruleId: string;
}

export class RuleEngine {
    constructor(
        private readonly rules: readonly Rule[],
        private readonly options: RuleEngineOptions = {},
        private readonly errorSink: RuleErrorSink = new NoopRuleErrorSink(),
    ) {}

    decide(call: CommandCall, context: RuleContext): Decision {
        if (call.argv.length === 0 || call.argv[0]?.value === undefined) {
            return { kind: "keep" };
        }

        const maxRounds = this.options.maxRounds ?? DEFAULT_MAX_ROUNDS;
        const resolver = new ReplacementResolver(call.argv);
        let current: readonly Replacement[] = call.argv.map(
            (_, index): Replacement => ({ kind: "arg", index }),
        );
        const injected: Record<string, string> = {};
        const applied: AppliedRule[] = [];
        const seen = new Set<string>([valueKey(call.argv)]);

        for (let round = 0; round < maxRounds; round += 1) {
            const argv = resolver.resolve(current);
            if (argv[0]?.value === undefined) {
                return { kind: "keep" };
            }
            const outcome = this.inspect(
                { argv, env: new OverlayEnvironment(call.env, injected) },
                context,
            );
            if (outcome === undefined) {
                break;
            }
            const verdict = outcome.verdict;
            if (verdict.kind === "block") {
                return {
                    kind: "block",
                    ruleId: outcome.ruleId,
                    message: verdict.message,
                };
            }
            if (verdict.kind !== "replace") {
                break;
            }
            applied.push({ ruleId: outcome.ruleId, reason: verdict.reason });
            if (verdict.env !== undefined) {
                Object.assign(injected, verdict.env);
            }
            const composed = compose(current, verdict.argv);
            if (composed === undefined) {
                break;
            }
            current = composed;
            const nextKey = valueKey(resolver.resolve(current));
            if (seen.has(nextKey)) {
                break;
            }
            seen.add(nextKey);
        }

        const finalArgv = resolver.resolve(current);
        if (applied.length === 0 || sameValues(finalArgv, call.argv)) {
            return { kind: "keep" };
        }
        return { kind: "replace", argv: current, env: injected, applied };
    }

    private inspect(call: CommandCall, context: RuleContext): RoundOutcome | undefined {
        for (const rule of this.rules) {
            if (rule.scope === "local" && context.host.kind === "remote") {
                continue;
            }
            let verdict: Verdict;
            try {
                verdict = rule.inspect(call, context);
            } catch (error) {
                this.errorSink.report({ ruleId: rule.id, error });
                continue;
            }
            if (verdict.kind !== "keep") {
                return { verdict, ruleId: rule.id };
            }
        }
        return undefined;
    }
}

/**
 * Composes this round's replacements (indices into the current argv) with the
 * mapping from current indices back to the original argv. Returns `undefined`
 * when a rule referenced an out-of-range index (a rule bug: fail open).
 */
function compose(
    current: readonly Replacement[],
    replacements: readonly Replacement[],
): readonly Replacement[] | undefined {
    const composed: Replacement[] = [];
    for (const replacement of replacements) {
        if (replacement.kind === "text") {
            composed.push(replacement);
            continue;
        }
        const referenced = current[replacement.index];
        if (referenced === undefined) {
            return undefined;
        }
        composed.push(referenced);
    }
    return composed;
}

/** A collision-free identity for an argv, used to detect cycles. */
function valueKey(argv: readonly CallArg[]): string {
    return JSON.stringify(argv.map((item) => item.value ?? null));
}

function sameValues(a: readonly CallArg[], b: readonly CallArg[]): boolean {
    return (
        a.length === b.length &&
        a.every((item, index) => item.value === b[index]?.value)
    );
}
