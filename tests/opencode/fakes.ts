import type { Plugin, PluginOptions } from "@opencode/plugin";

import type { AuditEntry, AuditLog, Clock } from "../../src/opencode/audit-log.ts";
import type { Logger } from "../../src/opencode/logger.ts";
import type { CommandProcessor, Outcome, ProcessRequest } from "../../src/outcome.ts";

/** A `CommandProcessor` that records requests and answers from a callback. */
export class RecordingProcessor implements CommandProcessor {
    readonly requests: ProcessRequest[] = [];

    constructor(private readonly respond: (request: ProcessRequest) => Outcome) {}

    process(request: ProcessRequest): Outcome {
        this.requests.push(request);
        return this.respond(request);
    }
}

/** An `AuditLog` that keeps every entry in memory. */
export class RecordingAuditLog implements AuditLog {
    readonly entries: AuditEntry[] = [];

    record(entry: AuditEntry): void {
        this.entries.push(entry);
    }
}

/** An `AuditLog` whose sink always fails. */
export class ThrowingAuditLog implements AuditLog {
    record(): void {
        throw new Error("audit sink exploded");
    }
}

/** A `Logger` that keeps every report in memory. */
export class RecordingLogger implements Logger {
    readonly errors: { readonly message: string; readonly cause: unknown }[] = [];

    error(message: string, cause?: unknown): void {
        this.errors.push({ message, cause });
    }
}

/** A `Logger` whose `error` always throws. */
export class ThrowingLogger implements Logger {
    error(): void {
        throw new Error("logger exploded");
    }
}

/** A `Clock` frozen on one instant. */
export class FixedClock implements Clock {
    constructor(private readonly instant: Date) {}

    now(): Date {
        return this.instant;
    }
}

/**
 * Builds an `AuditEntry`; `command`/`message` follow `outcome` unless overridden.
 */
export function auditEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
    const outcome = overrides.outcome ?? "rewritten";
    return {
        sessionID: "ses_1",
        callID: "call_1",
        cwd: "/w",
        original: "pip install requests",
        ruleIds: outcome === "rewritten" ? ["pip-to-manager"] : [],
        reasons: outcome === "rewritten" ? ["pip is not the manager here"] : [],
        outcome,
        ...(outcome === "rewritten" ? { command: "uv add requests" } : {}),
        ...(outcome === "blocked" ? { message: "blocked by a rule" } : {}),
        ...overrides,
    };
}

/** Builds an `execute.before` shell event, overriding any field. */
export function shellEvent(
    overrides: {
        readonly tool?: string;
        readonly sessionID?: string;
        readonly id?: string;
        readonly input?: unknown;
    } = {},
): Record<string, unknown> {
    const event: Record<string, unknown> = {
        tool: overrides.tool ?? "shell",
        sessionID: overrides.sessionID ?? "ses_1",
        agent: "build",
        messageID: "msg_1",
        id: overrides.id ?? "call_1",
        input: { command: "pip install requests" },
    };
    if ("input" in overrides) {
        event.input = overrides.input;
    }
    return event;
}

/** A test double for `Plugin.Context` plus the seams the tests inspect. */
export interface FakePluginContext {
    readonly context: Plugin.Context;
    readonly hooks: Map<string, (event: unknown) => unknown>;
    readonly sessionCalls: () => number;
    readonly disposed: () => boolean;
}

/**
 * Builds a minimal `Plugin.Context`. The real `Context` exposes some twenty
 * domains; `setup` reads only `options`, `location`, `session.get` and
 * `tool.hook`, so the fake implements those. The one narrowing in this file
 * goes through `unknown` because the fake deliberately omits the other domains.
 */
export function fakePluginContext(
    overrides: { readonly options?: PluginOptions; readonly directory?: string } = {},
): FakePluginContext {
    const hooks = new Map<string, (event: unknown) => unknown>();
    let sessionCalls = 0;
    let disposed = false;
    const fake = {
        options: overrides.options ?? {},
        location: { directory: overrides.directory ?? "/w" },
        session: {
            get: () => {
                sessionCalls += 1;
                return Promise.resolve({ location: { directory: "/w/session" } });
            },
        },
        tool: {
            hook: (name: string, callback: (event: unknown) => unknown) => {
                hooks.set(name, callback);
                return Promise.resolve({
                    dispose: () => {
                        disposed = true;
                        return Promise.resolve();
                    },
                });
            },
        },
    };
    return {
        context: fake as unknown as Plugin.Context,
        hooks,
        sessionCalls: () => sessionCalls,
        disposed: () => disposed,
    };
}
