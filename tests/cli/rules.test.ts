import { describe, expect, test } from "bun:test";

import { RulesCommand } from "../../src/cli/commands/rules.ts";
import type { CatalogReport } from "../../src/rules/custom/index.ts";
import { stubRule } from "../support/rules.ts";
import { FakeRuleAccess, outputOf, testIo } from "./fakes.ts";

const REPORT: CatalogReport = {
    rules: [
        {
            id: "make-test",
            source: "project",
            path: "/w/.opencode/bashlight/rules/make-test.ts",
            disabled: false,
            rule: stubRule("make-test"),
        },
        {
            id: "node-manager",
            source: "builtin",
            disabled: true,
            rule: stubRule("node-manager"),
        },
    ],
    errors: [
        {
            path: "/w/.opencode/bashlight/rules/bad.ts",
            message: "module has no default export",
        },
    ],
    customRulesEnabled: true,
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

    test("warns about untrusted project rule files", async () => {
        const report: CatalogReport = {
            rules: [],
            errors: [],
            customRulesEnabled: true,
            untrusted: { directory: "/w", files: 3 },
        };
        const io = testIo({ cwd: "/w", ruleAccess: new FakeRuleAccess(report) });
        await new RulesCommand().run(["--cwd", "/w"], io);
        const text = outputOf(io).text();
        expect(text).toContain("3 project rule file(s) found but not trusted");
        expect(text).toContain("bashlight trust /w");
    });

    test("says when custom rules are disabled", async () => {
        const report: CatalogReport = {
            rules: [],
            errors: [],
            customRulesEnabled: false,
        };
        const io = testIo({ cwd: "/w", ruleAccess: new FakeRuleAccess(report) });
        await new RulesCommand().run(["--cwd", "/w"], io);
        expect(outputOf(io).text()).toContain("Custom rules are disabled");
    });

    test("reports an empty active set", async () => {
        const io = testIo({
            ruleAccess: new FakeRuleAccess({
                rules: [],
                errors: [],
                customRulesEnabled: true,
            }),
        });
        await new RulesCommand().run([], io);
        expect(outputOf(io).text()).toContain("(none)");
    });

    test("refreshes the given directory", async () => {
        const access = new FakeRuleAccess();
        const io = testIo({ cwd: "/w", ruleAccess: access });
        await new RulesCommand().run(["--cwd", "/w"], io);
        expect(access.refreshed).toEqual(["/w"]);
    });

    test("rejects an unknown option", async () => {
        const io = testIo({ ruleAccess: new FakeRuleAccess() });
        const code = await new RulesCommand().run(["--nope"], io);
        expect(code).toBe(2);
        expect(outputOf(io).text()).toContain("unknown option");
    });
});
