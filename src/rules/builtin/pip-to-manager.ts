/**
 * Replaces `pip` dependency management with the project manager's own commands:
 * `pip install x` → `poetry add x`, editable/project installs → the manager's
 * sync, uninstall → remove, read-only subcommands → pip inside the project env.
 *
 * The per-manager spellings live in `pip-manager.ts`; this rule only decides
 * which pip operation it is looking at. Managers without a dependency-manager
 * CLI (hatch, a bare venv) are left to `python-runner`.
 */
import { pipDialect, type PipManagerDialect } from "../knowledge/pip-manager.ts";
import {
    isPipCommand,
    parsePythonCommand,
    pipSubcommand,
} from "../knowledge/python-command-line.ts";
import { resolveScript } from "../knowledge/script-resolver.ts";
import { isVenvExecutable } from "../knowledge/venv.ts";
import { isOption } from "../knowledge/words.ts";
import type { CallArg, Replacement } from "../rule.ts";
import type { CommandCall, Rule, RuleContext, Verdict } from "../rule.ts";
import { arg, argsFrom, indexRange, keep, replace } from "../verdict.ts";

export const INSTALL_REASON = "install with the project manager";
export const REMOVE_REASON = "remove with the project manager";
export const SYNC_REASON = "sync the project";
export const IN_ENV_REASON = "run pip inside the project";

const READ_ONLY_SUBCOMMANDS: ReadonlySet<string> = new Set([
    "list",
    "show",
    "freeze",
    "check",
]);

/** The installer tooling itself: always managed in the env, never `add`ed. */
const INSTALLER_TOOLING: ReadonlySet<string> = new Set(["pip", "setuptools", "wheel"]);

const DROPPED_FLAGS: ReadonlySet<string> = new Set([
    "--user",
    "--break-system-packages",
]);
const UPGRADE_FLAGS: ReadonlySet<string> = new Set(["-U", "--upgrade"]);
const QUIET_FLAGS: ReadonlySet<string> = new Set(["-q", "--quiet"]);
const REMOVE_FLAGS: ReadonlySet<string> = new Set(["-y", "--yes", "-q", "--quiet"]);

interface Spec {
    readonly index: number;
    /** A path, URL or `.` rather than a package name. */
    readonly local: boolean;
    /** Exactly the project itself (`.` / `./`). */
    readonly project: boolean;
}

interface InstallScan {
    upgrade: boolean;
    pre: boolean;
    unknownFlag: boolean;
    readonly requirements: number[];
    readonly editables: number[];
    readonly specs: Spec[];
    readonly dropped: Set<number>;
    projectEditable: boolean;
}

export class PipToManagerRule implements Rule {
    readonly id = "pip-to-manager";
    readonly scope = "local";

    inspect(call: CommandCall, context: RuleContext): Verdict {
        if (context.cwd === undefined) {
            return keep();
        }
        if (isVenvExecutable(call, context)) {
            return keep();
        }
        const project = context.project.python(context.cwd);
        if (project === undefined) {
            return keep();
        }
        const dialect = pipDialect(project.manager);
        if (dialect === undefined) {
            return keep();
        }
        const python = parsePythonCommand(call.argv, resolveScript(call, context));
        if (
            python === undefined ||
            python.runner.kind === "path" ||
            !isPipCommand(python)
        ) {
            return keep();
        }
        // A runner with options (`poetry -C api run pip …`) is left alone, like
        // python-runner does.
        if (python.runner.kind === "manager" && python.runner.hasOptions) {
            return keep();
        }
        const info = pipSubcommand(call.argv, python);
        if (info === undefined) {
            return keep();
        }
        const argsStart = info.index + 1;
        if (info.name === "install") {
            return this.install(call, dialect, argsStart);
        }
        if (info.name === "uninstall") {
            return remove(call, dialect, argsStart);
        }
        if (READ_ONLY_SUBCOMMANDS.has(info.name)) {
            return replace(
                dialect.inEnv(info.name, argsFrom(call.argv, argsStart)),
                IN_ENV_REASON,
            );
        }
        return keep();
    }

    private install(
        call: CommandCall,
        dialect: PipManagerDialect,
        argsStart: number,
    ): Verdict {
        const scan = scanInstall(call.argv, argsStart);
        if (scan.unknownFlag) {
            return installViaRunner(call, dialect, argsStart, scan.dropped);
        }
        if (scan.requirements.length > 0) {
            if (scan.specs.length > 0 || scan.editables.length > 0) {
                return installViaRunner(call, dialect, argsStart, scan.dropped);
            }
            return replace(dialect.requirements(scan.requirements), INSTALL_REASON);
        }
        if (scan.editables.length > 0) {
            if (scan.projectEditable && scan.specs.length === 0) {
                return replace(dialect.sync(), SYNC_REASON);
            }
            return installViaRunner(call, dialect, argsStart, scan.dropped);
        }
        if (scan.specs.length > 0 && scan.specs.every((spec) => spec.project)) {
            return replace(dialect.sync(), SYNC_REASON);
        }
        if (scan.specs.length > 0 && scan.specs.every((spec) => !spec.local)) {
            if (scan.specs.every((spec) => isToolingSpec(call.argv[spec.index]))) {
                return installViaRunner(call, dialect, argsStart, scan.dropped);
            }
            return replace(
                dialect.add({
                    specs: scan.specs.map((spec) => ({
                        index: spec.index,
                        value: call.argv[spec.index]?.value,
                    })),
                    upgrade: scan.upgrade,
                    pre: scan.pre,
                }),
                INSTALL_REASON,
            );
        }
        if (scan.specs.length > 0) {
            return installViaRunner(call, dialect, argsStart, scan.dropped);
        }
        return replace(dialect.sync(), SYNC_REASON);
    }
}

function scanInstall(argv: readonly CallArg[], from: number): InstallScan {
    const scan: InstallScan = {
        upgrade: false,
        pre: false,
        unknownFlag: false,
        requirements: [],
        editables: [],
        specs: [],
        dropped: new Set(),
        projectEditable: false,
    };
    let index = from;
    while (index < argv.length) {
        index = scanToken(argv, index, scan);
    }
    return scan;
}

function scanToken(argv: readonly CallArg[], index: number, scan: InstallScan): number {
    const value = argv[index]?.value;
    if (value === undefined) {
        scan.specs.push({ index, local: false, project: false });
        return index + 1;
    }
    if (UPGRADE_FLAGS.has(value)) {
        scan.upgrade = true;
        return index + 1;
    }
    if (value === "--pre") {
        scan.pre = true;
        return index + 1;
    }
    if (QUIET_FLAGS.has(value) || DROPPED_FLAGS.has(value)) {
        scan.dropped.add(index);
        return index + 1;
    }
    if (value === "-e" || value === "--editable") {
        return scanEditable(argv, index, scan);
    }
    if (value === "-r" || value === "--requirement") {
        return scanRequirement(argv, index, scan);
    }
    if (isOption(value)) {
        scan.unknownFlag = true;
        return index + 1;
    }
    scan.specs.push({
        index,
        local: isLocalSpec(value),
        project: value === "." || value === "./",
    });
    return index + 1;
}

function scanEditable(
    argv: readonly CallArg[],
    index: number,
    scan: InstallScan,
): number {
    if (argv[index + 1] === undefined) {
        scan.unknownFlag = true;
        return index + 1;
    }
    scan.editables.push(index + 1);
    const target = argv[index + 1]?.value;
    if (target === "." || target === "./") {
        scan.projectEditable = true;
    }
    return index + 2;
}

function scanRequirement(
    argv: readonly CallArg[],
    index: number,
    scan: InstallScan,
): number {
    if (argv[index + 1] === undefined) {
        scan.unknownFlag = true;
        return index + 1;
    }
    scan.requirements.push(index + 1);
    return index + 2;
}

function isLocalSpec(value: string): boolean {
    return (
        value === "." ||
        value === "./" ||
        value.startsWith(".") ||
        value.startsWith("/") ||
        value.includes("/")
    );
}

function isToolingSpec(callArg: CallArg | undefined): boolean {
    const name =
        callArg?.value === undefined ? undefined : distributionName(callArg.value);
    return name !== undefined && INSTALLER_TOOLING.has(name);
}

function distributionName(value: string): string | undefined {
    return /^[A-Za-z0-9._-]+/.exec(value)?.[0]?.toLowerCase();
}

function remove(
    call: CommandCall,
    dialect: PipManagerDialect,
    argsStart: number,
): Verdict {
    const packages: number[] = [];
    for (let index = argsStart; index < call.argv.length; index += 1) {
        const value = call.argv[index]?.value;
        if (value === undefined) {
            packages.push(index);
            continue;
        }
        if (REMOVE_FLAGS.has(value)) {
            continue;
        }
        if (isOption(value)) {
            return keep();
        }
        packages.push(index);
    }
    return packages.length === 0
        ? keep()
        : replace(dialect.remove(packages), REMOVE_REASON);
}

function installViaRunner(
    call: CommandCall,
    dialect: PipManagerDialect,
    argsStart: number,
    dropped: ReadonlySet<number>,
): Verdict {
    const kept: Replacement[] = indexRange(argsStart, call.argv.length)
        .filter((index) => !dropped.has(index))
        .map((index) => arg(index));
    return replace(dialect.installViaRunner(kept), INSTALL_REASON);
}
