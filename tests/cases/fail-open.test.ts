import { describe, expect, test } from "bun:test";

import { poetryProject, rewrite } from "./fixtures.ts";

const AT = { cwd: "/w", files: poetryProject("/w") };

describe("fail open", () => {
    test("leaves an unparseable command unchanged", () => {
        expect(rewrite("python a.py '", AT).kind).toBe("unchanged");
    });

    test("leaves a command with an unknown argv[0] unchanged", () => {
        expect(rewrite("$(which python) a.py", AT).kind).toBe("unchanged");
    });

    test("never touches a command without a rule match", () => {
        const outcome = rewrite("git status --short", AT);
        expect(outcome.kind).toBe("unchanged");
    });

    test("keeps the exact bytes of an untouched command", () => {
        const command = "echo  'two  spaces'   |   cat";
        const outcome = rewrite(command, AT);
        expect(outcome.kind).toBe("unchanged");
    });
});
