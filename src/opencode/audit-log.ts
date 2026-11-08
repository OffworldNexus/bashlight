/**
 * The audit trail of every shell call bashlight looked at.
 *
 * The interceptor depends on the `AuditLog` interface only; the composition
 * root picks the implementation. `JsonlAuditLog` is the only file in the
 * adapter that touches `node:fs`.
 */

import { appendFileSync, mkdirSync } from "node:fs";

import type { Outcome } from "../outcome.ts";
import { dirname } from "../shared/posix-path.ts";
import type { Logger } from "./logger.ts";

/** Injected time source so audit lines are deterministic in tests. */
export interface Clock {
    now(): Date;
}

/** One processed shell call. `time` is added by the log, not by the caller. */
export interface AuditEntry {
    readonly sessionID: string;
    readonly callID: string;
    /** The absolute directory the command was interpreted in. */
    readonly cwd: string;
    /** The command exactly as the agent wrote it. */
    readonly original: string;
    readonly outcome: Outcome["kind"];
    /** The command that actually ran; present only for `rewritten`. */
    readonly command?: string;
    /** The block message; present only for `blocked`. */
    readonly message?: string;
    readonly ruleIds: readonly string[];
    readonly reasons: readonly string[];
}

/** Sink for audit entries. Implementations never throw. */
export interface AuditLog {
    record(entry: AuditEntry): void;
}

/** Discards every entry; selected with `auditLog: false`. */
export class NoopAuditLog implements AuditLog {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the sink is intentionally empty
    record(_entry: AuditEntry): void {
        // Intentionally empty.
    }
}

/**
 * Appends one JSON object per line, creating the parent directory once on the
 * first write. The file grows without bound, so operators are expected to
 * rotate it (it is a plain append-only log).
 */
export class JsonlAuditLog implements AuditLog {
    private directoryReady = false;

    constructor(
        private readonly path: string,
        private readonly clock: Clock,
        private readonly logger: Logger,
    ) {}

    record(entry: AuditEntry): void {
        try {
            if (!this.directoryReady) {
                mkdirSync(dirname(this.path), { recursive: true });
                this.directoryReady = true;
            }
            const line = JSON.stringify({
                time: this.clock.now().toISOString(),
                ...entry,
            });
            appendFileSync(this.path, `${line}\n`);
        } catch (error) {
            this.logger.error(
                `could not append to the audit log at ${this.path}`,
                error,
            );
        }
    }
}
