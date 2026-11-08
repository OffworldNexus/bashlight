import { describe, expect, test } from "bun:test";

import { RulesCommand } from "../../src/cli/commands/rules.ts";
import type { CatalogReport } from "../../src/rules/custom/index.ts";
import type { Rule } from "../../src/rules/rule.ts";
import { FakeRuleAccess, outputOf, testIo } from "./fakes.ts";

function rule(id: string): Rule {
    return { id, scope: "local", inspect: () => ({ kind: "keep" }) };
}

const REPORT: CatalogReport = {
    rules: [
        {
            id: "make-test",
            source: "project",
            path: "/w/.opencode/bashlight/rules/make-test.ts",
            disabled: false,
            rule: rule("make-test"),
        },
        {
            id: "node-manager",
            source: "builtin",
            disabled: true,
            rule: rule("node-manager"),
        },
    ],
    errors: [
        {
            path: "/w/.opencode/bashlight/rules/bad.ts",
            message: "module has no default export",
        },
    ],
};

describe("rules", () => {
    test("lists active rules, disabled rules and load errors", async () => {
        const io = testIo({ cwd: "/w", ruleAccess: new FakeRuleAccess(REPORT) });
        const code = await new RulesCommand().run(["--cwd", "/w"], io);
        const text = outputOf(io).text();
        expect(code).toBe(0);
        expect(text).toContain("bashlight rules in /w");
        expect(text).toContain("make-test");
        expect(text).toContain("/w/.opencode/bashlight/rules/make-test.ts");
        expect(text).toContain("Disabled:");
        expect(text).toContain("node-manager");
        expect(text).toContain("Failed to load:");
        expect(text).toContain("module has no default export");
    });

    test("reports an empty active set", async () => {
        const io = testIo({
            ruleAccess: new FakeRuleAccess({ rules: [], errors: [] }),
        });
        await new RulesCommand().run([], io);
        expect(outputOf(io).text()).toContain("(none)");
    });

    test("rejects an unknown option", async () => {
        const io = testIo({ ruleAccess: new FakeRuleAccess() });
        const code = await new RulesCommand().run(["--nope"], io);
        expect(code).toBe(2);
        expect(outputOf(io).text()).toContain("unknown option");
    });
});
