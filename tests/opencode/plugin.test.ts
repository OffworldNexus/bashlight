import { describe, expect, test } from "bun:test";

import plugin, { readOptions, setup } from "../../src/opencode/plugin.ts";
import { fakePluginContext, shellEvent } from "./fakes.ts";

describe("plugin definition", () => {
    test("exports the v2 promise plugin shape", () => {
        expect(plugin.id).toBe("bashlight");
        expect(typeof plugin.setup).toBe("function");
    });
});

describe("readOptions", () => {
    test("prefers an absolute XDG_DATA_HOME", () => {
        expect(readOptions({}, { XDG_DATA_HOME: "/data" }).auditLog).toBe(
            "/data/bashlight/audit.jsonl",
        );
    });

    test("falls back to the injected HOME", () => {
        expect(readOptions({}, { HOME: "/home/u" }).auditLog).toBe(
            "/home/u/.local/share/bashlight/audit.jsonl",
        );
        expect(
            readOptions({}, { XDG_DATA_HOME: "relative", HOME: "/home/u" }).auditLog,
        ).toBe("/home/u/.local/share/bashlight/audit.jsonl");
    });

    test("honours an explicit path and the disable flag", () => {
        expect(readOptions({ auditLog: "/custom/a.jsonl" }, {}).auditLog).toBe(
            "/custom/a.jsonl",
        );
        expect(readOptions({ auditLog: false }, {}).auditLog).toBe(false);
        expect(readOptions({ auditLog: 42 }, {}).auditLog).not.toBe(false);
    });

    test("keeps only the string rule ids", () => {
        expect(
            readOptions({ disabledRules: ["a", 1, "", "b", null] }, {}).disabledRules,
        ).toEqual(["a", "b"]);
        expect(readOptions({ disabledRules: "a" }, {}).disabledRules).toEqual([]);
    });

    test("enables custom rules unless explicitly disabled", () => {
        expect(readOptions({}, {}).customRules).toBe(true);
        expect(readOptions({ customRules: true }, {}).customRules).toBe(true);
        expect(readOptions({ customRules: false }, {}).customRules).toBe(false);
        expect(readOptions({ customRules: "no" }, {}).customRules).toBe(true);
    });
});

describe("setup", () => {
    test("registers execute.before and returns a working cleanup", async () => {
        const fake = fakePluginContext({ options: { auditLog: false } });
        const cleanup = await setup(fake.context);
        expect([...fake.hooks.keys()]).toEqual(["execute.before"]);
        expect(typeof cleanup).toBe("function");
        await cleanup?.();
        expect(fake.disposed()).toBe(true);
    });

    test("the hook forwards shell calls and resolves the session directory", async () => {
        const fake = fakePluginContext({
            options: { auditLog: false },
            directory: "/w/project",
        });
        await setup(fake.context);
        // A command no rule touches, so the assertion is about wiring, not rules.
        const event = shellEvent({ input: { command: "echo hello" } });
        await fake.hooks.get("execute.before")?.(event);
        expect(fake.sessionCalls()).toBe(1);
        expect((event.input as { command: string }).command).toBe("echo hello");
    });
});
