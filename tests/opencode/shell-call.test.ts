import { describe, expect, test } from "bun:test";

import { parseShellCall, resolveCwd } from "../../src/opencode/shell-call.ts";
import { shellEvent } from "./fakes.ts";

describe("parseShellCall: tool recognition", () => {
    test("accepts the v2 shell tool", () => {
        const call = parseShellCall(shellEvent());
        expect(call?.command).toBe("pip install requests");
        expect(call?.sessionID).toBe("ses_1");
        expect(call?.callID).toBe("call_1");
    });

    test("accepts the legacy bash tool name", () => {
        const call = parseShellCall(shellEvent({ tool: "bash" }));
        expect(call?.command).toBe("pip install requests");
    });

    test("ignores any other tool", () => {
        for (const tool of ["read", "edit", "grep", "Bash", "shell "]) {
            expect(parseShellCall(shellEvent({ tool }))).toBeUndefined();
        }
    });
});

describe("parseShellCall: input shape", () => {
    test("carries the workdir when present", () => {
        const call = parseShellCall(
            shellEvent({ input: { command: "ls", workdir: "src" } }),
        );
        expect(call?.workdir).toBe("src");
    });

    test("omits an empty or non-string workdir", () => {
        expect(
            parseShellCall(shellEvent({ input: { command: "ls", workdir: "" } }))
                ?.workdir,
        ).toBeUndefined();
        expect(
            parseShellCall(shellEvent({ input: { command: "ls", workdir: 7 } }))
                ?.workdir,
        ).toBeUndefined();
    });

    test("rejects a missing or non-string command", () => {
        expect(parseShellCall(shellEvent({ input: {} }))).toBeUndefined();
        expect(parseShellCall(shellEvent({ input: { command: 7 } }))).toBeUndefined();
        expect(parseShellCall(shellEvent({ input: { command: "" } }))).toBeUndefined();
        expect(parseShellCall(shellEvent({ input: "ls -la" }))).toBeUndefined();
        expect(parseShellCall(shellEvent({ input: null }))).toBeUndefined();
    });

    test("rejects a missing session or call id", () => {
        expect(
            parseShellCall({
                tool: "shell",
                id: "call_1",
                input: { command: "ls" },
            }),
        ).toBeUndefined();
        expect(
            parseShellCall({
                tool: "shell",
                sessionID: "ses_1",
                input: { command: "ls" },
            }),
        ).toBeUndefined();
    });

    test("rejects anything that is not an object", () => {
        for (const event of [undefined, null, 42, "shell", [], ["shell"]]) {
            expect(parseShellCall(event)).toBeUndefined();
        }
    });

    test("rewrites the event command in place through replaceCommand", () => {
        const event = shellEvent();
        const call = parseShellCall(event);
        expect(call).toBeDefined();
        call?.replaceCommand("uv add requests");
        expect((event.input as { command: string }).command).toBe("uv add requests");
    });
});

describe("resolveCwd", () => {
    test("defaults to the session directory", () => {
        expect(resolveCwd("/w/api", undefined)).toBe("/w/api");
        expect(resolveCwd("/w/api", "")).toBe("/w/api");
    });

    test("resolves a relative workdir", () => {
        expect(resolveCwd("/w/api", "src")).toBe("/w/api/src");
        expect(resolveCwd("/w/api", "./src")).toBe("/w/api/src");
        expect(resolveCwd("/w/api", "../lib")).toBe("/w/lib");
    });

    test("keeps an absolute workdir", () => {
        expect(resolveCwd("/w/api", "/elsewhere/x")).toBe("/elsewhere/x");
    });
});
