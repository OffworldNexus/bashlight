import type { RuleErrorSink, RuleFailure } from "../rules/rule-engine.ts";

/**
 * Minimal logging seam for the OpenCode adapter.
 *
 * The adapter never touches the console directly except through this injected
 * interface: internal failures are reported here and never surfaced to
 * OpenCode, so a broken plugin leaves the agent's command untouched.
 */
export interface Logger {
    /** Reports a non-fatal failure; the caller keeps going. */
    error(message: string, cause?: unknown): void;
}

/**
 * The production `Logger`, writing to stderr with a stable prefix.
 *
 * It is an adapter (like `NodeFileSystem`): the only place in the adapter that
 * is allowed to reach for the console.
 */
export class ConsoleLogger implements Logger {
    error(message: string, cause?: unknown): void {
        if (cause === undefined) {
            console.error(`[bashlight] ${message}`);
        } else {
            console.error(`[bashlight] ${message}`, cause);
        }
    }
}

/**
 * Reports a rule that threw while inspecting a command. The engine has already
 * skipped it (fail-open); this only makes the bug visible to an operator.
 */
export class LoggingRuleErrorSink implements RuleErrorSink {
    constructor(private readonly logger: Logger) {}

    report(failure: RuleFailure): void {
        try {
            this.logger.error(
                `rule '${failure.ruleId}' threw and was skipped`,
                failure.error,
            );
        } catch {
            // A broken logger must not break a command either.
        }
    }
}
