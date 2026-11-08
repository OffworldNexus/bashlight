import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { ExplainCommand } from "../../src/cli/commands/explain.ts";
import { RulesCommand } from "../../src/cli/commands/rules.ts";
import { NodeCliFiles } from "../../src/cli/files.ts";
import { configDirectory } from "../../src/opencode/audit-log.ts";
import { NodeRuleDirectoryReader } from "../../src/opencode/rule-directory-reader.ts";
import { FileRuleModuleImporter } from "../../src/opencode/rule-module-importer.ts";
import {
    createRuleHelpers,
    RuleCatalog,
    RuleDirectories,
    RuleModuleLoader,
} from "../../src/rules/custom/index.ts";
import { outputOf, tempDir, testIo } from "./fakes.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
    for (const cleanup of cleanups.splice(0)) {
        cleanup();
    }
});

const ENV = { HOME: "/home/u" };

/** A rule file with no imports: it uses the injected helpers only. */
function ruleSource(id: string, target: string): string {
    return `export default (helpers) => ({
    id: ${JSON.stringify(id)},
    scope: "local",
    inspect(call) {
        if (call.argv[0]?.value !== "pytest") {
            return helpers.keep();
        }
        return helpers.replace(
            [...helpers.text("make", ${JSON.stringify(target)}), ...helpers.argsFrom(call.argv, 1)],
            "run the project's make target",
        );
    },
});
`;
}

/** A real catalog over the real file system. */
function realCatalog(): RuleCatalog {
    return new RuleCatalog({
        directories: new RuleDirectories(configDirectory(ENV)),
        reader: new NodeRuleDirectoryReader(),
        loader: new RuleModuleLoader({
            importer: new FileRuleModuleImporter(),
            helpers: createRuleHelpers(),
        }),
    });
}

/** A temp project with a custom rule file; returns its path and the rule path. */
function project(source: string): { path: string; ruleFile: string } {
    const { path, cleanup } = tempDir();
    cleanups.push(cleanup);
    const rulesDir = join(path, ".opencode", "bashlight", "rules");
    mkdirSync(rulesDir, { recursive: true });
    const ruleFile = join(rulesDir, "make-test.ts");
    writeFileSync(ruleFile, source);
    return { path, ruleFile };
}

describe("custom rules end to end", () => {
    test("explain applies a factory rule from the project folder", async () => {
        const { path } = project(ruleSource("make-test", "test"));
        const io = testIo({
            files: new NodeCliFiles(),
            fileSystem: new NodeCliFiles(),
            env: ENV,
            cwd: path,
            ruleAccess: realCatalog(),
        });
        await new ExplainCommand().run(["pytest -q", "--cwd", path], io);
        const text = outputOf(io).text();
        expect(text).toContain("rewritten:");
        expect(text).toContain("+ make test -q");
        expect(text).toContain("make-test");
    });

    test("rules lists the custom rule and its file", async () => {
        const { path, ruleFile } = project(ruleSource("make-test", "test"));
        const io = testIo({
            files: new NodeCliFiles(),
            fileSystem: new NodeCliFiles(),
            env: ENV,
            cwd: path,
            ruleAccess: realCatalog(),
        });
        const code = await new RulesCommand().run(["--cwd", path], io);
        const text = outputOf(io).text();
        expect(code).toBe(0);
        expect(text).toContain("make-test");
        expect(text).toContain(ruleFile);
        expect(text).toContain("project");
        expect(text).toContain("redundant-runner");
    });

    test("editing a rule file changes the next explain without restarting", async () => {
        const { path, ruleFile } = project(ruleSource("make-test", "test"));
        const catalog = realCatalog();
        const io = testIo({
            files: new NodeCliFiles(),
            fileSystem: new NodeCliFiles(),
            env: ENV,
            cwd: path,
            ruleAccess: catalog,
        });
        await new ExplainCommand().run(["pytest -q", "--cwd", path], io);
        expect(outputOf(io).text()).toContain("+ make test -q");

        writeFileSync(ruleFile, ruleSource("make-test", "check"));
        const future = new Date(Date.now() + 5000);
        utimesSync(ruleFile, future, future);

        await new ExplainCommand().run(["pytest -q", "--cwd", path], io);
        expect(outputOf(io).text()).toContain("+ make check -q");
    });

    test("a broken rule file is skipped, the command still runs", async () => {
        const { path } = project("export default 42;\n");
        const io = testIo({
            files: new NodeCliFiles(),
            fileSystem: new NodeCliFiles(),
            env: ENV,
            cwd: path,
            ruleAccess: realCatalog(),
        });
        await new ExplainCommand().run(["ls", "--cwd", path], io);
        expect(outputOf(io).text()).toContain("unchanged");
    });
});
