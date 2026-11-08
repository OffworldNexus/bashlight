/* eslint-disable sonarjs/function-return-type */
/**
 * `bashlight doctor` — diagnose the plugin installation.
 *
 * Checks the runtime (bun, opencode), whether the plugin is discoverable
 * project-locally or globally, the audit log and a live end-to-end self-test.
 * Nothing is modified; the config files are only read.
 */

import {
    AuditLogReader,
    defaultAuditLogPath,
    homeDirectory,
} from "../../opencode/audit-log.ts";
import type { Outcome } from "../../outcome.ts";
import { MemoryFileSystem } from "../../project/index.ts";
import { isRecord } from "../../shared/guards.ts";
import { dirname, join } from "../../shared/posix-path.ts";
import type { FlagSpec } from "../argv.ts";
import { parseArgv } from "../argv.ts";
import { type CliCommand, printCommandHelp, usageError } from "../command.ts";
import type { CliFiles } from "../files.ts";
import type { CommandIo } from "../io.ts";

const SPEC: readonly FlagSpec[] = [
    { name: "project", value: true },
    { name: "log", value: true },
];

const DAY_MILLISECONDS = 86_400_000;
/** A virtual path in the in-memory file system; never touched on disk. */
const SELF_TEST_CWD = "/bashlight-doctor";

type Severity = "pass" | "warn" | "fail";

interface Check {
    readonly severity: Severity;
    readonly label: string;
    readonly hint?: string;
}

/** Where the plugin's own entry point is re-exported from. */
const PLUGIN_REFERENCE = "opencode/plugin";

export class DoctorCommand implements CliCommand {
    readonly name = "doctor";
    readonly summary = "diagnose the plugin installation";
    readonly usage = "doctor [--project DIR] [--log PATH]";

    run(args: readonly string[], io: CommandIo): Promise<number> {
        return Promise.resolve(this.execute(args, io));
    }

    private execute(args: readonly string[], io: CommandIo): number {
        const parsed = parseArgv(args, SPEC);
        if (!parsed.ok) {
            return usageError(this, parsed.error, io);
        }
        if (parsed.flags.bool("help")) {
            printCommandHelp(this, io.output);
            return 0;
        }
        const project = parsed.flags.value("project") ?? io.cwd;
        const log = parsed.flags.value("log") ?? defaultAuditLogPath(io.env);
        const home = homeDirectory(io.env);
        const checks: Check[] = [
            checkBun(io),
            checkOpencode(io),
            checkPlugin(io.files, project, home),
            ...checkAuditLog(io, log),
            checkSelfTest(io),
        ];
        for (const check of checks) {
            io.output.line(renderCheck(check));
        }
        return checks.some((check) => check.severity === "fail") ? 1 : 0;
    }
}

function checkBun(io: CommandIo): Check {
    const result = io.runner.run("bun", ["--version"]);
    return result?.status === 0
        ? { severity: "pass", label: `bun ${result.stdout.trim()}` }
        : { severity: "fail", label: "bun", hint: "install Bun from https://bun.sh" };
}

function checkOpencode(io: CommandIo): Check {
    const result = io.runner.run("opencode", ["--version"]);
    return result?.status === 0
        ? { severity: "pass", label: `opencode ${result.stdout.trim()}` }
        : {
              severity: "warn",
              label: "opencode",
              hint: "not found on PATH — run doctor where you use OpenCode",
          };
}

function checkPlugin(files: CliFiles, project: string, home: string): Check {
    const local = findBashlightPlugin(files, join(project, ".opencode", "plugins"));
    const global = findBashlightPlugin(
        files,
        join(home, ".config", "opencode", "plugins"),
    );
    const config = [
        join(home, ".config", "opencode", "opencode.json"),
        join(home, ".config", "opencode", "opencode.jsonc"),
    ].find((path) => configMentions(files.readText(path)));
    const detail = [
        local === undefined ? undefined : `project: ${local}`,
        global === undefined ? undefined : `global: ${global}`,
        config === undefined ? undefined : `config: ${config}`,
    ].filter((part): part is string => part !== undefined);
    if (detail.length === 0) {
        return {
            severity: "fail",
            label: "plugin discoverability",
            hint: `add ${join(project, ".opencode", "plugins", "bashlight.ts")} re-exporting the plugin, or a 'plugins' entry in ~/.config/opencode/opencode.json`,
        };
    }
    return { severity: "pass", label: `plugin discoverability (${detail.join("; ")})` };
}

function checkAuditLog(io: CommandIo, path: string): readonly Check[] {
    const writable = io.files.canWrite(path);
    const size = io.files.size(path) ?? 0;
    const entries = new AuditLogReader().parse(io.files.readText(path) ?? "");
    const last = entries.at(-1);
    const recent = last === undefined ? "no entries yet" : `last entry ${last.time}`;
    const checks: Check[] = [];
    checks.push(
        writable
            ? {
                  severity: "pass",
                  label: `audit log ${path} (${size} bytes, ${recent})`,
              }
            : {
                  severity: "fail",
                  label: `audit log ${path}`,
                  hint: `not writable (${dirname(path)}); the plugin will silently skip auditing`,
              },
    );
    if (
        last === undefined ||
        io.clock.now().getTime() - Date.parse(last.time) > DAY_MILLISECONDS
    ) {
        checks.push({
            severity: "warn",
            label: "audit log is idle",
            hint: "no shell call seen recently — is the plugin loaded? check ~/.local/share/opencode/log/ for 'failed to load plugin'",
        });
    }
    return checks;
}

function checkSelfTest(io: CommandIo): Check {
    const fileSystem = new MemoryFileSystem({
        [`${SELF_TEST_CWD}/pyproject.toml`]: `[tool.poetry]
name = "doctor"
version = "0.0.0"
`,
        [`${SELF_TEST_CWD}/poetry.lock`]: "",
    });
    let outcome: Outcome;
    try {
        outcome = io.processorFactory(fileSystem).process({
            command: "pip install requests",
            cwd: SELF_TEST_CWD,
            env: {},
        });
    } catch (error) {
        return {
            severity: "fail",
            label: "self-test",
            hint: `the pipeline threw: ${messageOf(error)}`,
        };
    }
    if (outcome.kind === "rewritten" && outcome.command === "poetry add requests") {
        return {
            severity: "pass",
            label: "self-test: pip install requests → poetry add requests",
        };
    }
    return {
        severity: "fail",
        label: "self-test",
        hint: `expected 'poetry add requests', got ${describe(outcome)}`,
    };
}

/** A `.ts`/`.js` file in `dir` that likely re-exports the plugin. */
function findBashlightPlugin(files: CliFiles, dir: string): string | undefined {
    for (const name of files.list(dir)) {
        if (!name.endsWith(".ts") && !name.endsWith(".js")) {
            continue;
        }
        const path = join(dir, name);
        const text = files.readText(path);
        const mentions =
            name.toLowerCase().includes("bashlight") ||
            (text !== undefined &&
                (text.includes("bashlight") || text.includes(PLUGIN_REFERENCE)));
        if (mentions) {
            return path;
        }
    }
    return undefined;
}

/** Whether an opencode config names bashlight, parsed leniently (jsonc-safe). */
function configMentions(text: string | undefined): boolean {
    if (text === undefined || !text.includes("bashlight")) {
        return false;
    }
    try {
        const parsed: unknown = JSON.parse(text);
        if (isRecord(parsed)) {
            const plugins = parsed["plugins"] ?? parsed["plugin"];
            return (
                plugins === undefined || JSON.stringify(plugins).includes("bashlight")
            );
        }
    } catch {
        // A jsonc file we cannot parse still counts when it names bashlight.
    }
    return true;
}

const SYMBOLS: Readonly<Record<Severity, string>> = {
    pass: "✓",
    warn: "⚠",
    fail: "✗",
};

function renderCheck(check: Check): string {
    const head = `${SYMBOLS[check.severity]} ${check.label}`;
    return check.hint === undefined ? head : `${head} — ${check.hint}`;
}

function describe(outcome: Outcome): string {
    switch (outcome.kind) {
        case "rewritten":
            return `'${outcome.command}'`;
        case "blocked":
            return `blocked: ${outcome.message}`;
        case "unchanged":
            return "unchanged";
    }
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
