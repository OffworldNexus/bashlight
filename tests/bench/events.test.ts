import { describe, expect, test } from "bun:test";

import { parseActivity } from "../../bench/lib/events.ts";

function line(value: unknown): string {
    return JSON.stringify(value);
}

describe("parseActivity", () => {
    test("sums tokens and cost across step_finish events", () => {
        const text = [
            line({
                type: "step_finish",
                part: {
                    cost: 0.001,
                    tokens: {
                        input: 100,
                        output: 10,
                        reasoning: 5,
                        cache: { read: 20, write: 3 },
                    },
                },
            }),
            line({
                type: "step_finish",
                part: {
                    cost: 0.002,
                    tokens: {
                        input: 200,
                        output: 20,
                        reasoning: 0,
                        cache: { read: 0, write: 0 },
                    },
                },
            }),
        ].join("\n");

        const activity = parseActivity(text);
        expect(activity.costUsd).toBeCloseTo(0.003, 10);
        expect(activity.tokens).toEqual({
            input: 300,
            output: 30,
            reasoning: 5,
            cacheRead: 20,
            cacheWrite: 3,
        });
    });

    test("counts shell calls and their non-zero exits", () => {
        const text = [
            line({
                type: "tool_use",
                part: {
                    tool: "shell",
                    state: { status: "completed", metadata: { metadata: { exit: 0 } } },
                },
            }),
            line({
                type: "tool_use",
                part: {
                    tool: "shell",
                    state: { status: "completed", metadata: { metadata: { exit: 1 } } },
                },
            }),
            line({
                type: "tool_use",
                part: { tool: "read", state: { status: "completed" } },
            }),
        ].join("\n");

        const activity = parseActivity(text);
        expect(activity.toolCalls).toBe(3);
        expect(activity.shellCalls).toBe(2);
        expect(activity.failedShellCalls).toBe(1);
    });

    test("counts a shell tool error as a failed call", () => {
        const text = line({
            type: "tool_use",
            part: { tool: "shell", state: { status: "error" } },
        });
        const activity = parseActivity(text);
        expect(activity.shellCalls).toBe(1);
        expect(activity.failedShellCalls).toBe(1);
    });

    test("ignores malformed lines and captures error events", () => {
        const text = [
            "not json",
            "",
            line({ type: "error", error: { message: "boom" } }),
        ].join("\n");
        const activity = parseActivity(text);
        expect(activity.errors).toEqual(["boom"]);
        expect(activity.toolCalls).toBe(0);
        expect(activity.costUsd).toBe(0);
    });

    test("measures the time to the last passing test command", () => {
        const text = [
            line({ type: "step_start", timestamp: 1_000 }),
            line({
                type: "tool_use",
                timestamp: 2_000,
                part: {
                    tool: "shell",
                    state: {
                        status: "completed",
                        input: { command: "poetry run pytest -q" },
                        metadata: { metadata: { exit: 1 } },
                    },
                },
            }),
            line({
                type: "tool_use",
                timestamp: 5_000,
                part: {
                    tool: "shell",
                    state: {
                        status: "completed",
                        input: { command: "poetry run pytest -q" },
                        metadata: { metadata: { exit: 0 } },
                    },
                },
            }),
            line({
                type: "tool_use",
                timestamp: 9_000,
                part: {
                    tool: "shell",
                    state: {
                        status: "completed",
                        input: { command: "echo done" },
                        metadata: { metadata: { exit: 0 } },
                    },
                },
            }),
        ].join("\n");
        // The failing pytest run does not count; the last passing one does.
        expect(parseActivity(text).lastGreenMs).toBe(4_000);
    });

    test("reports no green when tests never pass", () => {
        const text = [
            line({ type: "step_start", timestamp: 1_000 }),
            line({
                type: "tool_use",
                timestamp: 2_000,
                part: {
                    tool: "shell",
                    state: {
                        status: "completed",
                        input: { command: "pytest" },
                        metadata: { metadata: { exit: 1 } },
                    },
                },
            }),
        ].join("\n");
        expect(parseActivity(text).lastGreenMs).toBe(0);
    });
});
