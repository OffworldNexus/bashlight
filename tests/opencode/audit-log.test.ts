import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";

import { JsonlAuditLog, NoopAuditLog } from "../../src/opencode/audit-log.ts";
import { auditEntry, FixedClock, RecordingLogger } from "./fakes.ts";

const base = join(tmpdir(), "opencode");
mkdirSync(base, { recursive: true });
const root = mkdtempSync(join(base, "bashlight-audit-"));

afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

describe("JsonlAuditLog", () => {
    test("appends one JSON line per entry, with an injected time", () => {
        const path = join(root, "plain", "audit.jsonl");
        const clock = new FixedClock(new Date("2026-01-02T03:04:05.000Z"));
        const log = new JsonlAuditLog(path, clock, new RecordingLogger());

        log.record(auditEntry());
        log.record(auditEntry({ outcome: "unchanged" }));

        const lines = readFileSync(path, "utf8").trimEnd().split("\n");
        expect(lines).toHaveLength(2);
        const first = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
        expect(first).toEqual({
            time: "2026-01-02T03:04:05.000Z",
            sessionID: "ses_1",
            callID: "call_1",
            cwd: "/w",
            original: "pip install requests",
            outcome: "rewritten",
            command: "uv add requests",
            ruleIds: ["pip-to-manager"],
            reasons: ["pip is not the manager here"],
        });
        const second = JSON.parse(lines[1] ?? "") as Record<string, unknown>;
        expect(second.time).toBe("2026-01-02T03:04:05.000Z");
        expect(second.outcome).toBe("unchanged");
        expect("command" in second).toBe(false);
    });

    test("creates the parent directory on demand", () => {
        const path = join(root, "deeply", "nested", "audit.jsonl");
        new JsonlAuditLog(
            path,
            new FixedClock(new Date()),
            new RecordingLogger(),
        ).record(auditEntry());
        expect(readFileSync(path, "utf8")).toContain(
            '"original":"pip install requests"',
        );
    });

    test("never throws: a failing append is reported to the logger", () => {
        const blocker = join(root, "blocker");
        writeFileSync(blocker, "not a directory");
        const logger = new RecordingLogger();
        const log = new JsonlAuditLog(
            join(blocker, "audit.jsonl"),
            new FixedClock(new Date()),
            logger,
        );

        expect(() => log.record(auditEntry())).not.toThrow();
        expect(logger.errors).toHaveLength(1);
    });
});

describe("NoopAuditLog", () => {
    test("discards entries without touching the disk", () => {
        expect(() => new NoopAuditLog().record(auditEntry())).not.toThrow();
    });
});
