import { describe, expect, test } from "bun:test";

import {
    AuditLogReader,
    defaultAuditLogPath,
    homeDirectory,
} from "../../src/opencode/audit-log.ts";

const VALID = JSON.stringify({
    time: "2026-01-02T03:04:05.000Z",
    sessionID: "ses_1",
    callID: "call_1",
    cwd: "/w",
    original: "pip install requests",
    outcome: "rewritten",
    command: "poetry add requests",
    ruleIds: ["pip-to-manager"],
    reasons: ["install with the manager"],
});

describe("AuditLogReader", () => {
    test("parses valid lines and skips blank, malformed and partial ones", () => {
        const text = [
            VALID,
            "",
            "not json at all",
            '{"time":"nope","sessionID":"x"}',
            '{"time":"2026-01-02T03:04:05.000Z"}',
            '{"time":"2026-01-02T03:04:05.000Z","sessionID":"s","callID":"c","cwd":"/w","original":"ls","outcome":"bogus","ruleIds":[],"reasons":[]}',
            VALID,
            '{"time":"2026-01-02T03:04:05.000Z","sessionID":"s","callID":"c","cwd":"/w","original":"ls","outcome":"unchanged","ruleIds":[1],"reasons":[]}',
        ].join("\n");

        const entries = new AuditLogReader().parse(text);
        expect(entries).toHaveLength(2);
        expect(entries[0]?.command).toBe("poetry add requests");
        expect(entries[1]?.ruleIds).toEqual(["pip-to-manager"]);
    });

    test("keeps optional command/message only when present and well-typed", () => {
        const blocked = JSON.stringify({
            time: "2026-01-02T03:04:05.000Z",
            sessionID: "s",
            callID: "c",
            cwd: "/w",
            original: "pip install x",
            outcome: "blocked",
            message: "no",
            ruleIds: [],
            reasons: [],
            command: 5,
        });
        const entries = new AuditLogReader().parse(blocked);
        expect(entries).toHaveLength(1);
        expect(entries[0]?.message).toBe("no");
        expect(Object.hasOwn(entries[0] ?? {}, "command")).toBe(false);
    });
});

describe("audit log path helpers", () => {
    test("prefers an absolute XDG_DATA_HOME", () => {
        expect(defaultAuditLogPath({ XDG_DATA_HOME: "/data" })).toBe(
            "/data/bashlight/audit.jsonl",
        );
    });

    test("falls back to the injected HOME", () => {
        expect(defaultAuditLogPath({ HOME: "/home/u" })).toBe(
            "/home/u/.local/share/bashlight/audit.jsonl",
        );
        expect(
            defaultAuditLogPath({ XDG_DATA_HOME: "relative", HOME: "/home/u" }),
        ).toBe("/home/u/.local/share/bashlight/audit.jsonl");
    });

    test("homeDirectory uses HOME when set", () => {
        expect(homeDirectory({ HOME: "/home/u" })).toBe("/home/u");
    });
});
