/**
 * The bridge between an OpenCode tool event and bashlight's `CommandProcessor`.
 *
 * The handler is fully fail-open: parsing, directory resolution, the processor,
 * the audit sink and the logger are all under one guard, and a throwing logger
 * cannot escape either. The single deliberate exception is a `block` verdict,
 * re-thrown as a `BlockedCommandError` for OpenCode to turn into a tool error
 * the model reads. The verdict is applied independently of auditing, so a
 * broken audit sink can never change what runs (or whether a command is
 * blocked).
 */

import type { CommandProcessor, Outcome } from "../outcome.ts";
import type { AuditEntry, AuditLog } from "./audit-log.ts";
import type { Logger } from "./logger.ts";
import { parseShellCall, resolveCwd, type ShellCall } from "./shell-call.ts";

/** Everything the interceptor collaborates with, injected by the plugin. */
export interface ShellInterceptorDeps {
    readonly processor: CommandProcessor;
    readonly auditLog: AuditLog;
    readonly logger: Logger;
    /** Provides the environment the shell will inherit. */
    readonly env: () => Readonly<Record<string, string>>;
    /** The absolute directory the session runs in, cached by the caller. */
    readonly directoryFor: (sessionID: string) => Promise<string> | string;
    /**
     * Refreshes the custom rules for a project directory before processing. It
     * may reject; the failure is logged and the command still runs.
     */
    readonly refreshRules?: (directory: string) => Promise<void>;
}

/** The deliberate, propagating rejection produced by a `block` verdict. */
class BlockedCommandError extends Error {
    override readonly name = "BlockedCommandError";
}

export class ShellInterceptor {
    constructor(private readonly deps: ShellInterceptorDeps) {}

    /** Handles one `execute.before` event; a non-shell event is ignored. */
    async handle(event: unknown): Promise<void> {
        try {
            const call = parseShellCall(event);
            if (call === undefined) {
                return;
            }
            const directory = await this.deps.directoryFor(call.sessionID);
            const cwd = resolveCwd(directory, call.workdir);
            await this.refreshRules(directory);
            const outcome = this.deps.processor.process({
                command: call.command,
                cwd,
                env: this.deps.env(),
                projectDir: directory,
            });
            this.recordQuietly(auditEntry(call, cwd, outcome));
            this.apply(call, outcome);
        } catch (error) {
            if (error instanceof BlockedCommandError) {
                throw error;
            }
            this.log("bashlight failed; the command runs unchanged", error);
        }
    }

    /** Refreshes the per-directory rules; a failure is logged, never fatal. */
    private async refreshRules(directory: string): Promise<void> {
        if (this.deps.refreshRules === undefined) {
            return;
        }
        try {
            await this.deps.refreshRules(directory);
        } catch (error) {
            this.log("could not load the custom rules; using the built-ins", error);
        }
    }

    /** Applies the verdict: mutate the command, or raise the block rejection. */
    private apply(call: ShellCall, outcome: Outcome): void {
        if (outcome.kind === "rewritten") {
            call.replaceCommand(outcome.command);
        } else if (outcome.kind === "blocked") {
            throw new BlockedCommandError(outcome.message);
        }
    }

    /** Audits without ever letting the sink affect the verdict. */
    private recordQuietly(entry: AuditEntry): void {
        try {
            this.deps.auditLog.record(entry);
        } catch (error) {
            this.log("could not record the audit entry", error);
        }
    }

    /** Logs without ever letting a throwing logger escape. */
    private log(message: string, cause: unknown): void {
        try {
            this.deps.logger.error(message, cause);
        } catch {
            // A broken logger must not break a command either.
        }
    }
}

type AuditFields = Pick<
    AuditEntry,
    "outcome" | "command" | "message" | "ruleIds" | "reasons"
>;

function auditEntry(call: ShellCall, cwd: string, outcome: Outcome): AuditEntry {
    return {
        sessionID: call.sessionID,
        callID: call.callID,
        cwd,
        original: call.command,
        ...auditFieldsOf(outcome),
    };
}

/** The outcome-derived audit fields, keeping `command`/`message` disjoint. */
function auditFieldsOf(outcome: Outcome): AuditFields {
    switch (outcome.kind) {
        case "rewritten":
            return {
                outcome: "rewritten",
                command: outcome.command,
                ruleIds: outcome.changes.flatMap((change) => change.ruleIds),
                reasons: outcome.changes.flatMap((change) => change.reasons),
            };
        case "blocked":
            return {
                outcome: "blocked",
                message: outcome.message,
                ruleIds: outcome.ruleIds,
                reasons: [],
            };
        case "unchanged":
            return {
                outcome: "unchanged",
                ruleIds: [],
                reasons: outcome.reason === undefined ? [] : [outcome.reason],
            };
    }
}
