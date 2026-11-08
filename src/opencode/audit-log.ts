/* eslint-disable sonarjs/function-return-type */
/**
 * The audit trail of every shell call bashlight looked at.
 *
 * The interceptor depends on the `AuditLog` interface only; the composition
 * root picks the implementation. `JsonlAuditLog` is the only file in the
 * adapter that touches `node:fs`.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";

import type { Outcome } from "../outcome.ts";
import { isRecord } from "../shared/guards.ts";
import { dirname, join } from "../shared/posix-path.ts";
import type { Logger } from "./logger.ts";

/** The environment the path helpers may read (injectable for tests). */
export type Environment = Readonly<Record<string, string | undefined>>;

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

/**
 * The home directory from the injected environment, falling back to the OS.
 * Shared by the plugin and the CLI so both resolve the same default paths.
 */
export function homeDirectory(env: Environment): string {
    const home = env.HOME;
    return home !== undefined && home !== "" ? home : homedir();
}

/** Resolves `$XDG_DATA_HOME/bashlight/audit.jsonl` or the `~/.local/share` one. */
export function defaultAuditLogPath(env: Environment): string {
    const dataHome = env.XDG_DATA_HOME;
    const base =
        dataHome !== undefined && dataHome.startsWith("/")
            ? dataHome
            : join(homeDirectory(env), ".local", "share");
    return join(base, "bashlight", "audit.jsonl");
}

/**
 * The OpenCode config directory: `$XDG_CONFIG_HOME/opencode` or
 * `~/.config/opencode`. The plugin and the CLI resolve custom rules and the
 * `opencode.json` they look at from here.
 */
export function configDirectory(env: Environment): string {
    const configHome = env.XDG_CONFIG_HOME;
    const base =
        configHome !== undefined && configHome.startsWith("/")
            ? configHome
            : join(homeDirectory(env), ".config");
    return join(base, "opencode");
}

/** An audit entry as written on disk: the recorded fields plus its timestamp. */
export interface TimedAuditEntry extends AuditEntry {
    /** ISO 8601 timestamp added by {@link JsonlAuditLog}. */
    readonly time: string;
}

function isStringArray(value: unknown): value is readonly string[] {
    return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isOutcomeKind(value: unknown): value is Outcome["kind"] {
    return value === "rewritten" || value === "blocked" || value === "unchanged";
}

function optionalString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

/**
 * The validated entry without its optional fields, or `undefined` when a
 * required field is missing or ill-typed.
 */
function requiredFields(
    value: Readonly<Record<string, unknown>>,
): Omit<TimedAuditEntry, "command" | "message"> | undefined {
    const { time, sessionID, callID, cwd, original, outcome, ruleIds, reasons } = value;
    if (typeof time !== "string" || Number.isNaN(Date.parse(time))) {
        return undefined;
    }
    if (
        typeof sessionID !== "string" ||
        typeof callID !== "string" ||
        typeof cwd !== "string" ||
        typeof original !== "string"
    ) {
        return undefined;
    }
    if (!isOutcomeKind(outcome) || !isStringArray(ruleIds) || !isStringArray(reasons)) {
        return undefined;
    }
    return { time, sessionID, callID, cwd, original, outcome, ruleIds, reasons };
}

/** Validates one parsed JSON value into an entry, or `undefined`. */
function parseEntry(value: unknown): TimedAuditEntry | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    const required = requiredFields(value);
    if (required === undefined) {
        return undefined;
    }
    const command = optionalString(value.command);
    const message = optionalString(value.message);
    return {
        ...required,
        ...(command === undefined ? {} : { command }),
        ...(message === undefined ? {} : { message }),
    };
}

/**
 * Reads the JSONL audit log: the counterpart of {@link JsonlAuditLog}, living
 * next to it so the format has one owner. Malformed lines (a partial append, a
 * hand-edited file) are skipped rather than throwing, so a follower can safely
 * re-parse a file it is concurrently reading.
 */
export class AuditLogReader {
    /** Parses every line of a JSONL document, skipping blank/malformed ones. */
    parse(text: string): readonly TimedAuditEntry[] {
        const entries: TimedAuditEntry[] = [];
        for (const line of text.split("\n")) {
            const entry = parseEntry(parseJson(line));
            if (entry !== undefined) {
                entries.push(entry);
            }
        }
        return entries;
    }
}

/** `JSON.parse` of a trimmed line, or `undefined` when it is not valid JSON. */
function parseJson(line: string): unknown {
    const trimmed = line.trim();
    if (trimmed === "") {
        return undefined;
    }
    try {
        return JSON.parse(trimmed);
    } catch {
        return undefined;
    }
}
