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
});
