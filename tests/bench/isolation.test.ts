import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";

import { NodeBenchFileSystem } from "../../bench/lib/fs.ts";
import { Isolation } from "../../bench/lib/isolation.ts";

const root = mkdtempSync(join(tmpdir(), "bashlight-bench-isolation-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const fs = new NodeBenchFileSystem();
const isolation = new Isolation(fs);

function setup(mode: "with" | "without", name: string) {
    const runDirectory = join(root, name);
    const projectDirectory = join(runDirectory, "project");
    fs.mkdirp(projectDirectory);
    const isolated = isolation.setup({
        runDirectory,
        projectDirectory,
        sharedCache: "/shared-cache",
        apiKey: "sk-secret",
        parentEnv: { PATH: "/usr/bin", SECRET_FROM_USER: "leak" },
    });
    isolation.installPlugin({
        projectDirectory,
        mode,
        pluginEntry: "/repo/src/opencode/plugin.ts",
    });
    return { runDirectory, projectDirectory, isolated };
}

describe("Isolation", () => {
    test("writes a minimal config that denies the dangerous commands", () => {
        const { runDirectory } = setup("without", "config");
        const config = JSON.parse(
            readFileSync(join(runDirectory, "config/opencode/opencode.json"), "utf8"),
        ) as {
            permissions: Array<{ action: string; resource: string; effect: string }>;
            mcp?: unknown;
        };
        expect(config.mcp).toBeUndefined();
        expect(config.permissions).toEqual([
            { action: "shell", resource: "sudo *", effect: "deny" },
            { action: "shell", resource: "*--break-system-packages*", effect: "deny" },
            { action: "shell", resource: "pip install --user*", effect: "deny" },
        ]);
    });

    test("builds an environment that keeps user values out", () => {
        const { runDirectory, isolated } = setup("without", "env");
        expect(isolated.env.HOME).toBe(join(runDirectory, "home"));
        expect(isolated.env.XDG_DATA_HOME).toBe(join(runDirectory, "data"));
        expect(isolated.env.OPENCODE_TEST_HOME).toBe(join(runDirectory, "home"));
        expect(isolated.env.OPENROUTER_API_KEY).toBe("sk-secret");
        expect(isolated.env.PIP_REQUIRE_VIRTUALENV).toBe("1");
        expect(isolated.env.POETRY_CACHE_DIR).toBe("/shared-cache/poetry");
        expect(isolated.env.PATH).toBe("/usr/bin");
        expect("SECRET_FROM_USER" in isolated.env).toBe(false);
        expect(isolated.auditLogPath).toBe(
            join(runDirectory, "data/bashlight/audit.jsonl"),
        );
    });

    test("installs the plugin by re-export in with mode", () => {
        const { projectDirectory } = setup("with", "plugin-with");
        const plugin = readFileSync(
            join(projectDirectory, ".opencode/plugins/bashlight.ts"),
            "utf8",
        );
        expect(plugin).toContain("/repo/src/opencode/plugin.ts");
    });

    test("removes any project-local .opencode in without mode", () => {
        const runDirectory = join(root, "plugin-without");
        const projectDirectory = join(runDirectory, "project");
        fs.writeFile(join(projectDirectory, ".opencode/plugins/x.ts"), "x");
        isolation.installPlugin({
            projectDirectory,
            mode: "without",
            pluginEntry: "/p",
        });
        expect(fs.exists(join(projectDirectory, ".opencode"))).toBe(false);
    });
});
