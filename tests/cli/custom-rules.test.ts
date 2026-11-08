import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { ExplainCommand } from "../../src/cli/commands/explain.ts";
import { RulesCommand } from "../../src/cli/commands/rules.ts";
import { TrustCommand } from "../../src/cli/commands/trust.ts";
import { UntrustCommand } from "../../src/cli/commands/untrust.ts";
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
import { StaticTrust } from "../support/rules.ts";
import { FakeTrust, outputOf, tempDir, testIo } from "./fakes.ts";

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

/** A real catalog over the real file system, trusting `trusted`. */
function realCatalog(trusted: readonly string[] = []): RuleCatalog {
    return new RuleCatalog({
        directories: new RuleDirectories(configDirectory(ENV)),
        reader: new NodeRuleDirectoryReader(),
        loader: new RuleModuleLoader({
            importer: new FileRuleModuleImporter(),
            helpers: createRuleHelpers(),
        }),
        trust: new StaticTrust(trusted),
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

function ioFor(path: string, catalog: RuleCatalog) {
    return testIo({
        files: new NodeCliFiles(),
        fileSystem: new NodeCliFiles(),
        env: ENV,
        cwd: path,
        ruleAccess: catalog,
    });
}

describe("custom rules end to end", () => {
    test("explain applies a factory rule from a trusted project folder", async () => {
        const { path } = project(ruleSource("make-test", "test"));
        const io = ioFor(path, realCatalog([path]));
        await new ExplainCommand().run(["pytest -q", "--cwd", path], io);
        const text = outputOf(io).text();
        expect(text).toContain("rewritten:");
        expect(text).toContain("+ make test -q");
        expect(text).toContain("make-test");
    });

    test("project rules are ignored until the project is trusted", async () => {
        const { path } = project(ruleSource("make-test", "test"));
        const io = ioFor(path, realCatalog([]));
        await new ExplainCommand().run(["pytest -q", "--cwd", path], io);
        expect(outputOf(io).text()).toContain("unchanged");
    });

    test("rules lists the custom rule and its file", async () => {
        const { path, ruleFile } = project(ruleSource("make-test", "test"));
        const io = ioFor(path, realCatalog([path]));
        const code = await new RulesCommand().run(["--cwd", path], io);
        const text = outputOf(io).text();
        expect(code).toBe(0);
        expect(text).toContain("make-test");
        expect(text).toContain(ruleFile);
        expect(text).toContain("project");
        expect(text).toContain("redundant-runner");
    });

    test("rules warns about untrusted project rule files", async () => {
        const { path } = project(ruleSource("make-test", "test"));
        const io = ioFor(path, realCatalog([]));
        await new RulesCommand().run(["--cwd", path], io);
        const text = outputOf(io).text();
        expect(text).toContain("1 project rule file(s) found but not trusted");
        expect(text).toContain(`bashlight trust ${path}`);
    });

    test("trust then untrust flips whether the rule loads", async () => {
        const { path } = project(ruleSource("make-test", "test"));
        const trust = new FakeTrust([]);
        const catalog = new RuleCatalog({
            directories: new RuleDirectories(configDirectory(ENV)),
            reader: new NodeRuleDirectoryReader(),
            loader: new RuleModuleLoader({
                importer: new FileRuleModuleImporter(),
                helpers: createRuleHelpers(),
            }),
            trust,
        });
        const io = testIo({
            files: new NodeCliFiles(),
            fileSystem: new NodeCliFiles(),
            env: ENV,
            cwd: path,
            ruleAccess: catalog,
            trust,
        });
        await new ExplainCommand().run(["pytest -q", "--cwd", path], io);
        expect(outputOf(io).lines.join("\n")).toContain("unchanged");

        const trustCode = await new TrustCommand().run([path], io);
        expect(trustCode).toBe(0);
        expect(outputOf(io).text()).toContain(`trusted ${path}`);

        await new ExplainCommand().run(["pytest -q", "--cwd", path], io);
        expect(outputOf(io).text()).toContain("+ make test -q");

        const untrustCode = await new UntrustCommand().run([path], io);
        expect(untrustCode).toBe(0);
        expect(outputOf(io).text()).toContain(`untrusted ${path}`);
    });

    test("editing a rule file changes the next explain without restarting", async () => {
        const { path, ruleFile } = project(ruleSource("make-test", "test"));
        const catalog = realCatalog([path]);
        const io = ioFor(path, catalog);
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
        const io = ioFor(path, realCatalog([path]));
        await new ExplainCommand().run(["ls", "--cwd", path], io);
        expect(outputOf(io).text()).toContain("unchanged");
    });
});
