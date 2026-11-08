/**
 * `bashlight doctor` — diagnose the plugin installation.
 *
 * Checks the runtime (bun, opencode), whether the plugin is discoverable
 * project-locally or globally, the audit log and a live end-to-end self-test.
 * Nothing is modified; the config files are only read.
 */

import {
    AuditLogReader,
    configDirectory,
    defaultAuditLogPath,
} from "../../opencode/audit-log.ts";
import type { Outcome } from "../../outcome.ts";
import { MemoryFileSystem } from "../../project/index.ts";
import type { CatalogReport } from "../../rules/custom/index.ts";
import { dirname } from "../../shared/posix-path.ts";
import type { FlagSpec } from "../argv.ts";
import { parseArgv } from "../argv.ts";
import { type CliCommand, printCommandHelp, usageError } from "../command.ts";
import type { CliFiles } from "../files.ts";
import type { CommandIo } from "../io.ts";
import { discoverPlugin, INSTALL_SNIPPET } from "../plugin-discovery.ts";

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

export class DoctorCommand implements CliCommand {
    readonly name = "doctor";
    readonly summary = "diagnose the plugin installation";
    readonly usage = "doctor [--project DIR] [--log PATH]";

    run(args: readonly string[], io: CommandIo): Promise<number> {
        return this.execute(args, io);
    }

    private async execute(args: readonly string[], io: CommandIo): Promise<number> {
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
        await io.ruleAccess.prepare(project);
        const checks: Check[] = [
            checkBun(io),
            checkOpencode(io),
            checkPlugin(io.files, project, configDirectory(io.env)),
            checkCustomRules(io.ruleAccess.report(project)),
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

function checkPlugin(files: CliFiles, project: string, configDir: string): Check {
    const discovery = discoverPlugin(files, project, configDir);
    if (!discovery.found) {
        return {
            severity: "fail",
            label: "plugin discoverability",
            hint: `add to opencode.json:\n    ${INSTALL_SNIPPET}`,
        };
    }
    return {
        severity: "pass",
        label: `plugin discoverability (${discovery.details.join("; ")})`,
    };
}

/** Reports rule files the catalog could not load (warn: fail-open). */
function checkCustomRules(report: CatalogReport): Check {
    if (report.errors.length === 0) {
        return { severity: "pass", label: "custom rules" };
    }
    const hint = report.errors
        .map((error) => `${error.path}: ${error.message}`)
        .join("; ");
    return { severity: "warn", label: "custom rules", hint };
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
