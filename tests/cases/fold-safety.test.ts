import { describe, expect, test } from "bun:test";

import { poetryProject, rewrite, rewritten } from "./fixtures.ts";

const AT = { cwd: "/w", files: poetryProject("/w") };

/** The binding fold would rewrite the assignment to this value. */
const FOLDED = ['P="poetry run python"', "P='poetry run python'"];

function folded(command: string): boolean {
    const result = rewritten(command, AT);
    return result !== undefined && FOLDED.some((fold) => result.includes(fold));
}

describe("binding fold safety", () => {
    test("folds when every use is a plain expansion", () => {
        expect(folded("P=python; $P a.py; $P b.py")).toBe(true);
    });

    test("does not fold when a use computes the length", () => {
        expect(folded("P=python; $P a.py; : > ${#P}")).toBe(false);
    });

    test("does not fold when a use is in a redirect target", () => {
        expect(folded("P=python; $P a.py; echo hi > ${P:5}.log")).toBe(false);
    });

    test("does not fold when a use is in a heredoc", () => {
        expect(folded("P=python; $P a.py; cat <<EOF\n${#P}\nEOF")).toBe(false);
    });

    test("does not fold when a use is in an fd redirect", () => {
        expect(folded("P=python; $P a.py; exec 3>${#P}.log")).toBe(false);
    });

    test("does not fold when an arithmetic command reads the variable", () => {
        expect(folded("P=python; $P a.py; (( P + 1 ))")).toBe(false);
    });

    test("does not fold when an arithmetic expansion reads the variable", () => {
        expect(folded("P=python; $P a.py; echo $((P + 1))")).toBe(false);
    });

    test("does not fold when let reads the variable", () => {
        expect(folded("P=python; $P a.py; let P+1")).toBe(false);
    });

    test("does not fold when a use is in a nested script", () => {
        expect(folded("bash -c 'P=python; $P a.py; : > ${#P}'")).toBe(false);
    });

    test("folds inside a nested script when all its uses are plain", () => {
        const result = rewritten("bash -c 'P=python; $P a.py; $P b.py'", AT);
        expect(result).toContain("poetry run python");
    });

    test("does not fold a top-level assignment used in a nested script", () => {
        const command = "P=python; export P; bash -c '$P a.py'";
        const result = rewrite(command, AT);
        if (result.kind === "rewritten") {
            expect(result.command).not.toContain('P="poetry run python"');
        }
    });
});
