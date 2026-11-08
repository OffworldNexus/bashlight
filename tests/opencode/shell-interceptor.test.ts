import { describe, expect, test } from "bun:test";

import type { AuditLog } from "../../src/opencode/audit-log.ts";
import type { Logger } from "../../src/opencode/logger.ts";
import { ShellInterceptor } from "../../src/opencode/shell-interceptor.ts";
import type { CommandProcessor, Outcome } from "../../src/outcome.ts";
import {
    auditEntry,
    RecordingAuditLog,
    RecordingLogger,
    RecordingProcessor,
    shellEvent,
    ThrowingAuditLog,
    ThrowingLogger,
} from "./fakes.ts";

const REWRITTEN: Outcome = {
    kind: "rewritten",
    command: "uv add requests",
    changes: [
        {
            ruleIds: ["pip-to-manager"],
            reasons: ["pip is not the manager here"],
            before: "pip install requests",
            after: "uv add requests",
        },
    ],
};

const BLOCKED: Outcome = {
    kind: "blocked",
    message: "pip install is not allowed outside a project",
    ruleIds: ["bare-python"],
};

interface InterceptorOptions {
    readonly outcome?: Outcome;
    readonly directory?: string;
    readonly directoryFor?: (sessionID: string) => Promise<string> | string;
    readonly processor?: CommandProcessor;
    readonly auditLog?: AuditLog;
    readonly logger?: Logger;
}

function interceptor(options: InterceptorOptions = {}): ShellInterceptor {
    return new ShellInterceptor({
        processor:
            options.processor ??
            new RecordingProcessor(() => options.outcome ?? { kind: "unchanged" }),
        auditLog: options.auditLog ?? new RecordingAuditLog(),
        logger: options.logger ?? new RecordingLogger(),
        env: () => ({ PATH: "/usr/bin" }),
        directoryFor: options.directoryFor ?? (() => options.directory ?? "/w/api"),
    });
}

/** Runs `call`, returning the error it threw (or `undefined` when it resolved). */
async function rejection(call: () => Promise<void>): Promise<unknown> {
    try {
        await call();
        return undefined;
    } catch (error) {
        return error;
    }
}

describe("ShellInterceptor: routing", () => {
    test("ignores a non-shell tool", async () => {
        const processor = new RecordingProcessor(() => ({ kind: "unchanged" }));
        const auditLog = new RecordingAuditLog();
        await interceptor({ processor, auditLog }).handle(shellEvent({ tool: "read" }));
        expect(processor.requests).toHaveLength(0);
        expect(auditLog.entries).toHaveLength(0);
    });

    test("ignores malformed input", async () => {
        const processor = new RecordingProcessor(() => ({ kind: "unchanged" }));
        const instance = interceptor({ processor });
        await instance.handle(shellEvent({ input: { notACommand: true } }));
        await instance.handle("nonsense");
        expect(processor.requests).toHaveLength(0);
    });

    test("handles the legacy bash tool name", async () => {
        const processor = new RecordingProcessor(() => ({ kind: "unchanged" }));
        await interceptor({ processor }).handle(shellEvent({ tool: "bash" }));
        expect(processor.requests).toHaveLength(1);
    });
});

describe("ShellInterceptor: cwd and env", () => {
    test("defaults to the session directory", async () => {
        const processor = new RecordingProcessor(() => ({ kind: "unchanged" }));
        await interceptor({ processor, directory: "/w/api" }).handle(shellEvent());
        expect(processor.requests[0]?.cwd).toBe("/w/api");
        expect(processor.requests[0]?.env).toEqual({ PATH: "/usr/bin" });
    });

    test("resolves a relative workdir against it", async () => {
        const processor = new RecordingProcessor(() => ({ kind: "unchanged" }));
        await interceptor({ processor, directory: "/w/api" }).handle(
            shellEvent({ input: { command: "ls", workdir: "src" } }),
        );
        expect(processor.requests[0]?.cwd).toBe("/w/api/src");
    });

    test("keeps an absolute workdir", async () => {
        const processor = new RecordingProcessor(() => ({ kind: "unchanged" }));
        await interceptor({ processor, directory: "/w/api" }).handle(
            shellEvent({ input: { command: "ls", workdir: "/elsewhere/x" } }),
        );
        expect(processor.requests[0]?.cwd).toBe("/elsewhere/x");
    });
});

describe("ShellInterceptor: outcomes", () => {
    test("rewritten mutates the command in place and audits", async () => {
        const auditLog = new RecordingAuditLog();
        const event = shellEvent();
        await interceptor({ outcome: REWRITTEN, auditLog }).handle(event);
        expect((event.input as { command: string }).command).toBe("uv add requests");
        expect(auditLog.entries).toEqual([auditEntry({ cwd: "/w/api" })]);
    });

    test("unchanged leaves the command untouched and audits", async () => {
        const auditLog = new RecordingAuditLog();
        const event = shellEvent();
        await interceptor({
            outcome: { kind: "unchanged", reason: "no rule" },
            auditLog,
        }).handle(event);
        expect((event.input as { command: string }).command).toBe(
            "pip install requests",
        );
        expect(auditLog.entries).toEqual([
            auditEntry({ cwd: "/w/api", outcome: "unchanged", reasons: ["no rule"] }),
        ]);
    });

    test("blocked audits and rejects with a BlockedCommandError", async () => {
        const auditLog = new RecordingAuditLog();
        const event = shellEvent();
        const error = await rejection(() =>
            interceptor({ outcome: BLOCKED, auditLog }).handle(event),
        );
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).name).toBe("BlockedCommandError");
        expect((error as Error).message).toBe(BLOCKED.message);
        expect((event.input as { command: string }).command).toBe(
            "pip install requests",
        );
        expect(auditLog.entries).toEqual([
            auditEntry({
                cwd: "/w/api",
                outcome: "blocked",
                message: BLOCKED.message,
                ruleIds: ["bare-python"],
            }),
        ]);
    });
});

describe("ShellInterceptor: fail open", () => {
    test("a processor that throws leaves the command untouched and logs", async () => {
        const logger = new RecordingLogger();
        const auditLog = new RecordingAuditLog();
        const processor = new RecordingProcessor(() => {
            throw new Error("processor exploded");
        });
        const event = shellEvent();
        await interceptor({ processor, auditLog, logger }).handle(event);
        expect((event.input as { command: string }).command).toBe(
            "pip install requests",
        );
        expect(logger.errors).toHaveLength(1);
        expect(auditLog.entries).toHaveLength(0);
    });

    test("a directory resolver that throws leaves the command untouched and logs", async () => {
        const logger = new RecordingLogger();
        const processor = new RecordingProcessor(() => ({ kind: "unchanged" }));
        const event = shellEvent();
        await interceptor({
            processor,
            logger,
            directoryFor: () => {
                throw new Error("no session");
            },
        }).handle(event);
        expect(processor.requests).toHaveLength(0);
        expect((event.input as { command: string }).command).toBe(
            "pip install requests",
        );
        expect(logger.errors).toHaveLength(1);
    });

    test("an async directory resolver is awaited", async () => {
        const processor = new RecordingProcessor(() => ({ kind: "unchanged" }));
        await interceptor({
            processor,
            directoryFor: () => Promise.resolve("/w/session"),
        }).handle(shellEvent());
        expect(processor.requests[0]?.cwd).toBe("/w/session");
    });

    test("a throwing audit sink does not stop a block", async () => {
        const logger = new RecordingLogger();
        const event = shellEvent();
        const error = await rejection(() =>
            interceptor({
                outcome: BLOCKED,
                auditLog: new ThrowingAuditLog(),
                logger,
            }).handle(event),
        );
        expect((error as Error).name).toBe("BlockedCommandError");
        expect((event.input as { command: string }).command).toBe(
            "pip install requests",
        );
        expect(logger.errors).toHaveLength(1);
    });

    test("a throwing audit sink never changes a rewrite", async () => {
        const event = shellEvent();
        await interceptor({
            outcome: REWRITTEN,
            auditLog: new ThrowingAuditLog(),
        }).handle(event);
        expect((event.input as { command: string }).command).toBe("uv add requests");
    });

    test("a throwing logger cannot escape", async () => {
        const processor = new RecordingProcessor(() => {
            throw new Error("processor exploded");
        });
        const event = shellEvent();
        await interceptor({ processor, logger: new ThrowingLogger() }).handle(event);
        expect((event.input as { command: string }).command).toBe(
            "pip install requests",
        );
    });
});
