import { describe, expect, test } from "bun:test";

import { summarizeAudit } from "../../bench/lib/audit-summary.ts";

describe("summarizeAudit", () => {
    test("tallies each outcome and skips malformed lines", () => {
        const text = [
            JSON.stringify({ outcome: "rewritten", original: "pip install x" }),
            JSON.stringify({ outcome: "unchanged", original: "ls" }),
            "{ not json",
            "",
            JSON.stringify({ outcome: "rewritten", original: "npm i x" }),
            JSON.stringify({ outcome: "blocked", original: "pip install x" }),
            JSON.stringify({ nope: true }),
        ].join("\n");

        expect(summarizeAudit(text)).toEqual({
            rewrites: 2,
            blocks: 1,
            unchanged: 1,
        });
    });

    test("returns zeros for an empty log", () => {
        expect(summarizeAudit("")).toEqual({ rewrites: 0, blocks: 0, unchanged: 0 });
    });
});
