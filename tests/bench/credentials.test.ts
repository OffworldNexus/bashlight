import { describe, expect, test } from "bun:test";

import { OpenRouterCredentials } from "../../bench/lib/credentials.ts";

const KEY = "sk-or-v1-example";

describe("OpenRouterCredentials", () => {
    test("prefers the environment override", () => {
        const credentials = new OpenRouterCredentials({
            env: { HOME: "/home/u", OPENROUTER_API_KEY: KEY },
            readText: () => {
                throw new Error("should not read the store");
            },
        });
        expect(credentials.key()).toBe(KEY);
    });

    test("reads the openrouter entry out of the XDG auth store", () => {
        const credentials = new OpenRouterCredentials({
            env: { XDG_DATA_HOME: "/data" },
            readText: (path) =>
                path === "/data/opencode/auth.json"
                    ? JSON.stringify({ openrouter: { type: "api", key: KEY } })
                    : undefined,
        });
        expect(credentials.key()).toBe(KEY);
    });

    test("falls back to HOME/.local/share", () => {
        const seen: string[] = [];
        const credentials = new OpenRouterCredentials({
            env: { HOME: "/home/u" },
            readText: (path) => {
                seen.push(path);
                return JSON.stringify({ openrouter: { key: KEY } });
            },
        });
        expect(credentials.key()).toBe(KEY);
        expect(seen).toEqual(["/home/u/.local/share/opencode/auth.json"]);
    });

    test("throws a message that never contains a key", () => {
        const credentials = new OpenRouterCredentials({
            env: {},
            readText: () => undefined,
        });
        expect(() => credentials.key()).toThrow(/OPENROUTER_API_KEY/);
    });
});
