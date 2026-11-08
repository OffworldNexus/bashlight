/* eslint-disable sonarjs/function-return-type */
/**
 * How each dependency-manager CLI expresses the pip operations `pip-to-manager`
 * rewrites. One parameterized dialect per manager, so the rule holds no
 * per-manager `switch`.
 */
import type { PythonManager } from "../../project/index.ts";
import type { Replacement } from "../rule.ts";
import { arg, text } from "../verdict.ts";
import { type PythonRunnerManager, RUNNER_MANAGERS } from "./python-command-line.ts";

/** Managers whose CLI owns `pip install` (hatch and bare venvs do not). */
export type PipManagedManager = Exclude<PythonRunnerManager, "hatch">;

export const PIP_MANAGERS: readonly PipManagedManager[] = RUNNER_MANAGERS.filter(
    (manager): manager is PipManagedManager => manager !== "hatch",
);

export function isPipManaged(manager: PythonManager): manager is PipManagedManager {
    return PIP_MANAGERS.includes(manager as PipManagedManager);
}

/** A package spec being added, as an argv word. */
export interface PipSpec {
    readonly index: number;
    readonly value: string | undefined;
}

export interface PipAdd {
    readonly specs: readonly PipSpec[];
    /** `-U`/`--upgrade`. */
    readonly upgrade: boolean;
    /** `--pre`. */
    readonly pre: boolean;
}

export interface PipManagerDialect {
    readonly manager: PipManagedManager;
    /** `pip install <specs>` → the manager's add. */
    add(input: PipAdd): readonly Replacement[];
    /** `pip install [-e] .` → the manager's sync. */
    sync(): readonly Replacement[];
    /** `pip install -r f` → requirements handling. */
    requirements(files: readonly number[]): readonly Replacement[];
    /** `pip uninstall <pkgs>` → the manager's remove. */
    remove(packages: readonly number[]): readonly Replacement[];
    /** A read-only pip subcommand, run in the project env. */
    inEnv(subcommand: string, rest: readonly Replacement[]): readonly Replacement[];
    /** Arbitrary `pip install …`, kept but run through the manager. */
    installViaRunner(args: readonly Replacement[]): readonly Replacement[];
}

interface DialectConfig {
    readonly manager: PipManagedManager;
    readonly add: readonly string[];
    /** Words turning `--pre` into this manager's prerelease flag. */
    readonly prerelease: readonly string[];
    readonly upgrade: "latest" | "package" | "none";
    readonly sync: readonly string[];
    readonly requirements: readonly string[];
    readonly remove: readonly string[];
    readonly inEnv: readonly string[];
    readonly installViaRunner: readonly string[];
}

class TablePipDialect implements PipManagerDialect {
    constructor(private readonly config: DialectConfig) {}

    get manager(): PipManagedManager {
        return this.config.manager;
    }

    add(input: PipAdd): Replacement[] {
        const argv = [...text(...this.config.add)];
        if (input.pre) {
            argv.push(...text(...this.config.prerelease));
        }
        if (this.config.upgrade === "latest") {
            for (const spec of input.specs) {
                argv.push(input.upgrade ? appendLatest(spec) : arg(spec.index));
            }
            return argv;
        }
        argv.push(...input.specs.map((spec) => arg(spec.index)));
        if (input.upgrade && this.config.upgrade === "package") {
            for (const spec of input.specs) {
                const name = upgradeName(spec.value);
                if (name !== undefined) {
                    argv.push(...text("--upgrade-package", name));
                }
            }
        }
        return argv;
    }

    sync(): Replacement[] {
        return [...text(...this.config.sync)];
    }

    requirements(files: readonly number[]): Replacement[] {
        const argv = [...text(...this.config.requirements)];
        for (const file of files) {
            argv.push(...text("-r"), arg(file));
        }
        return argv;
    }

    remove(packages: readonly number[]): Replacement[] {
        return [...text(...this.config.remove), ...packages.map((pkg) => arg(pkg))];
    }

    inEnv(subcommand: string, rest: readonly Replacement[]): Replacement[] {
        return [...text(...this.config.inEnv, subcommand), ...rest];
    }

    installViaRunner(args: readonly Replacement[]): Replacement[] {
        return [...text(...this.config.installViaRunner), ...args];
    }
}

function appendLatest(spec: PipSpec): Replacement {
    if (spec.value === undefined || /[<>=!~@]/.test(spec.value)) {
        return arg(spec.index);
    }
    return { kind: "text", value: `${spec.value}@latest` };
}

function upgradeName(value: string | undefined): string | undefined {
    if (value === undefined || value.includes("/") || value.includes(":")) {
        return undefined;
    }
    return /^[A-Za-z0-9._-]+/.exec(value)?.[0];
}

const DIALECTS: Readonly<Record<PipManagedManager, PipManagerDialect>> = Object.freeze({
    poetry: new TablePipDialect({
        manager: "poetry",
        add: ["poetry", "add"],
        prerelease: ["--allow-prereleases"],
        upgrade: "latest",
        sync: ["poetry", "install"],
        requirements: ["poetry", "run", "pip", "install"],
        remove: ["poetry", "remove"],
        inEnv: ["poetry", "run", "pip"],
        installViaRunner: ["poetry", "run", "pip", "install"],
    }),
    uv: new TablePipDialect({
        manager: "uv",
        add: ["uv", "add"],
        prerelease: ["--prerelease", "allow"],
        upgrade: "package",
        sync: ["uv", "sync"],
        requirements: ["uv", "add"],
        remove: ["uv", "remove"],
        inEnv: ["uv", "pip"],
        installViaRunner: ["uv", "pip", "install"],
    }),
    pipenv: new TablePipDialect({
        manager: "pipenv",
        add: ["pipenv", "install"],
        prerelease: ["--pre"],
        upgrade: "none",
        sync: ["pipenv", "install", "-e", "."],
        requirements: ["pipenv", "install"],
        remove: ["pipenv", "uninstall"],
        inEnv: ["pipenv", "run", "pip"],
        installViaRunner: ["pipenv", "run", "pip", "install"],
    }),
    pdm: new TablePipDialect({
        manager: "pdm",
        add: ["pdm", "add"],
        prerelease: ["--pre"],
        upgrade: "none",
        sync: ["pdm", "install"],
        requirements: ["pdm", "run", "pip", "install"],
        remove: ["pdm", "remove"],
        inEnv: ["pdm", "run", "pip"],
        installViaRunner: ["pdm", "run", "pip", "install"],
    }),
});

export function pipDialect(manager: PythonManager): PipManagerDialect | undefined {
    return isPipManaged(manager) ? DIALECTS[manager] : undefined;
}
