/* eslint-disable sonarjs/cognitive-complexity, sonarjs/function-return-type */
/**
 * One reading of a Node package-manager command line, normalized to an action
 * independent of npm/pnpm/yarn/bun spelling, plus the dialect that renders an
 * action back into a specific manager.
 *
 * `parseNodeCommand` is the single place that knows the subcommand aliases and
 * flags; the dialect table is the single place that knows how to spell an
 * action for each manager.
 */
import type { NodeManager, Shebang } from "../../project/index.ts";
import { basename } from "../../shared/posix-path.ts";
import type { CallArg, Replacement } from "../rule.ts";
import { arg, indexRange, text } from "../verdict.ts";
import { isPythonInterpreter, pythonManagerOf } from "./python-command-line.ts";
import { isOption } from "./words.ts";

/** What the command line does, in manager-neutral terms. */
export type NodeAction =
    | { readonly kind: "install" }
    | { readonly kind: "ci" }
    | {
          readonly kind: "add";
          readonly packages: readonly number[];
          readonly dev: boolean;
          readonly exact: boolean;
          readonly optional: boolean;
      }
    | { readonly kind: "remove"; readonly packages: readonly number[] }
    | {
          readonly kind: "run";
          readonly script: number;
          readonly args: readonly number[];
          /** Set when the script name is not the word at `script`. */
          readonly scriptName?: string;
      }
    | {
          readonly kind: "exec";
          readonly binary: number;
          readonly args: readonly number[];
          readonly download: boolean;
          /** Indices of `-p`/`--package` values. */
          readonly packages: readonly number[];
      }
    | { readonly kind: "global" }
    | { readonly kind: "other" };

export interface NodeCommand {
    /** The effective manager (npx→npm, pnpx→pnpm, bunx→bun). */
    readonly manager: NodeManager;
    readonly action: NodeAction;
}

interface AddFlags {
    readonly dev: readonly string[];
    readonly exact: readonly string[];
    readonly optional: readonly string[];
}

const NPM_ADD_FLAGS: AddFlags = {
    dev: ["-D", "--save-dev"],
    exact: ["-E", "--save-exact"],
    optional: ["-O", "--save-optional"],
};
const PNPM_ADD_FLAGS: AddFlags = NPM_ADD_FLAGS;
const YARN_ADD_FLAGS: AddFlags = {
    dev: ["-D", "--dev"],
    exact: ["-E", "--exact"],
    optional: ["-O", "--optional"],
};
const BUN_ADD_FLAGS: AddFlags = {
    dev: ["-d", "-D", "--dev", "--development"],
    exact: ["-E", "--exact"],
    optional: ["--optional"],
};

const NPM_INSTALL: ReadonlySet<string> = new Set([
    "install",
    "i",
    "in",
    "ins",
    "inst",
    "insta",
    "instal",
    "isntall",
    "add",
]);
const NPM_UNINSTALL: ReadonlySet<string> = new Set([
    "uninstall",
    "remove",
    "rm",
    "r",
    "unlink",
]);

const PNPM_INSTALL: ReadonlySet<string> = new Set(["install", "i", "add"]);
const PNPM_UNINSTALL: ReadonlySet<string> = new Set(["remove", "rm", "uninstall"]);
const PNPM_BUILTINS: ReadonlySet<string> = new Set([
    "install",
    "i",
    "add",
    "remove",
    "rm",
    "uninstall",
    "update",
    "up",
    "upgrade",
    "exec",
    "dlx",
    "run",
    "test",
    "t",
    "start",
    "stop",
    "restart",
    "publish",
    "list",
    "ls",
    "why",
    "outdated",
    "audit",
    "config",
    "init",
    "create",
    "import",
    "rebuild",
    "prune",
    "deploy",
    "licenses",
    "patch",
    "link",
    "unlink",
    "store",
    "setup",
    "root",
    "bin",
    "env",
    "server",
    "fetch",
    "approve-builds",
    "dedupe",
    "doctor",
    "help",
    "completions",
    "self-update",
    "recursive",
    "filter",
]);

const YARN_INSTALL: ReadonlySet<string> = new Set(["install", "add"]);
const YARN_UNINSTALL: ReadonlySet<string> = new Set(["remove", "rm"]);
const YARN_BUILTINS: ReadonlySet<string> = new Set([
    "install",
    "add",
    "remove",
    "rm",
    "up",
    "upgrade",
    "run",
    "exec",
    "dlx",
    "global",
    "init",
    "publish",
    "test",
    "t",
    "start",
    "why",
    "info",
    "list",
    "config",
    "cache",
    "import",
    "licenses",
    "link",
    "unlink",
    "pack",
    "plugin",
    "policies",
    "set",
    "version",
    "workspaces",
    "workspace",
    "node",
    "npm",
    "patch",
    "patch-commit",
    "rebuild",
    "search",
    "team",
    "help",
    "create",
    "bin",
    "dedupe",
    "outdated",
    "prune",
    "constraints",
    "explain",
    "stage",
]);

const BUN_INSTALL: ReadonlySet<string> = new Set(["install", "i", "add", "a"]);
const BUN_UNINSTALL: ReadonlySet<string> = new Set(["remove", "rm", "uninstall"]);

/** The `test`/`start`/… shorthand every manager shares. */
const LIFECYCLE: Readonly<Record<string, string>> = {
    test: "test",
    t: "test",
    start: "start",
    stop: "stop",
    restart: "restart",
};

/** Node runtimes and managers themselves; a shebang using them is left alone. */
export const NODE_RUNTIME_TOOLS: ReadonlySet<string> = new Set([
    "node",
    "npm",
    "npx",
    "pnpm",
    "pnpx",
    "yarn",
    "bun",
    "bunx",
    "corepack",
]);

function isGlobalFlag(value: string): boolean {
    return value === "-g" || value === "--global";
}

function parseRun(argv: readonly CallArg[], from: number): NodeAction {
    const script = argv[from]?.value;
    if (script === undefined) {
        return { kind: "other" };
    }
    let argsStart = from + 1;
    if (argv[argsStart]?.value === "--") {
        argsStart += 1;
    }
    return { kind: "run", script: from, args: indexRange(argsStart, argv.length) };
}

/**
 * A lifecycle alias (`npm test`, `pnpm t`…). The script name is the canonical
 * one, so it is only spelled out when the alias word differs (`t` → `test`);
 * a leading `--` is stripped like `parseRun` does.
 */
function lifecycleAction(
    argv: readonly CallArg[],
    script: number,
    lifecycle: string,
): NodeAction {
    let argsStart = script + 1;
    if (argv[argsStart]?.value === "--") {
        argsStart += 1;
    }
    const args = indexRange(argsStart, argv.length);
    return argv[script]?.value === lifecycle
        ? { kind: "run", script, args }
        : { kind: "run", script, args, scriptName: lifecycle };
}

function parseInstallOrAdd(
    argv: readonly CallArg[],
    from: number,
    flags: AddFlags,
    frozenSupported: boolean,
): NodeAction {
    let dev = false;
    let exact = false;
    let optional = false;
    let frozen = false;
    const packages: number[] = [];
    for (let index = from; index < argv.length; index += 1) {
        const value = argv[index]?.value;
        if (value === undefined) {
            packages.push(index);
            continue;
        }
        if (isGlobalFlag(value)) {
            return { kind: "global" };
        }
        if (flags.dev.includes(value)) {
            dev = true;
            continue;
        }
        if (flags.exact.includes(value)) {
            exact = true;
            continue;
        }
        if (flags.optional.includes(value)) {
            optional = true;
            continue;
        }
        if (value === "-S" || value === "--save") {
            continue;
        }
        if (
            frozenSupported &&
            (value === "--frozen-lockfile" || value === "--immutable")
        ) {
            frozen = true;
            continue;
        }
        if (isOption(value)) {
            return { kind: "other" };
        }
        packages.push(index);
    }
    if (packages.length > 0) {
        return { kind: "add", packages, dev, exact, optional };
    }
    return frozen ? { kind: "ci" } : { kind: "install" };
}

function parseCi(argv: readonly CallArg[], from: number): NodeAction {
    for (let index = from; index < argv.length; index += 1) {
        const value = argv[index]?.value;
        if (value === undefined) {
            return { kind: "other" };
        }
        if (isGlobalFlag(value)) {
            return { kind: "global" };
        }
        return { kind: "other" };
    }
    return { kind: "ci" };
}

function parseRemove(argv: readonly CallArg[], from: number): NodeAction {
    const packages: number[] = [];
    for (let index = from; index < argv.length; index += 1) {
        const value = argv[index]?.value;
        if (value === undefined) {
            packages.push(index);
            continue;
        }
        if (isGlobalFlag(value)) {
            return { kind: "global" };
        }
        if (
            value === "-y" ||
            value === "--yes" ||
            value === "-q" ||
            value === "--quiet" ||
            value === "-s" ||
            value === "--silent"
        ) {
            continue;
        }
        if (isOption(value)) {
            return { kind: "other" };
        }
        packages.push(index);
    }
    if (packages.length === 0) {
        return { kind: "other" };
    }
    return { kind: "remove", packages };
}

function parseExec(
    argv: readonly CallArg[],
    start: number,
    download: boolean,
): NodeAction {
    let index = start;
    const packages: number[] = [];
    for (;;) {
        const value = argv[index]?.value;
        if (value === undefined) {
            return { kind: "other" };
        }
        if (value === "--") {
            index += 1;
            break;
        }
        if (!isOption(value)) {
            break;
        }
        if (
            value === "-y" ||
            value === "--yes" ||
            value === "--no-install" ||
            value === "-q" ||
            value === "--quiet" ||
            value === "--silent"
        ) {
            index += 1;
            continue;
        }
        if (value === "-p" || value === "--package") {
            if (argv[index + 1] === undefined) {
                return { kind: "other" };
            }
            packages.push(index + 1);
            index += 2;
            continue;
        }
        return { kind: "other" };
    }
    const binary = argv[index]?.value;
    if (binary === undefined) {
        return { kind: "other" };
    }
    return {
        kind: "exec",
        binary: index,
        args: indexRange(index + 1, argv.length),
        download,
        packages,
    };
}

function npmAction(argv: readonly CallArg[]): NodeAction {
    const sub = argv[1]?.value;
    if (sub === undefined) {
        return { kind: "other" };
    }
    if (sub === "global" || isGlobalFlag(sub)) {
        return { kind: "global" };
    }
    if (NPM_INSTALL.has(sub)) {
        return parseInstallOrAdd(argv, 2, NPM_ADD_FLAGS, false);
    }
    if (sub === "ci") {
        return parseCi(argv, 2);
    }
    if (NPM_UNINSTALL.has(sub)) {
        return parseRemove(argv, 2);
    }
    if (sub === "run" || sub === "run-script") {
        return parseRun(argv, 2);
    }
    if (sub === "exec" || sub === "x") {
        return parseExec(argv, 2, false);
    }
    const lifecycle = LIFECYCLE[sub];
    return lifecycle === undefined
        ? { kind: "other" }
        : lifecycleAction(argv, 1, lifecycle);
}

function pnpmAction(argv: readonly CallArg[]): NodeAction {
    const sub = argv[1]?.value;
    if (sub === undefined) {
        return { kind: "other" };
    }
    if (sub === "global" || isGlobalFlag(sub)) {
        return { kind: "global" };
    }
    if (PNPM_INSTALL.has(sub)) {
        return parseInstallOrAdd(argv, 2, PNPM_ADD_FLAGS, true);
    }
    if (PNPM_UNINSTALL.has(sub)) {
        return parseRemove(argv, 2);
    }
    if (sub === "run") {
        return parseRun(argv, 2);
    }
    if (sub === "exec") {
        return parseExec(argv, 2, false);
    }
    if (sub === "dlx") {
        return parseExec(argv, 2, true);
    }
    const lifecycle = LIFECYCLE[sub];
    if (lifecycle !== undefined) {
        return lifecycleAction(argv, 1, lifecycle);
    }
    return PNPM_BUILTINS.has(sub) ? { kind: "other" } : parseRun(argv, 1);
}

function yarnAction(argv: readonly CallArg[]): NodeAction {
    const sub = argv[1]?.value;
    if (sub === undefined) {
        return { kind: "install" };
    }
    if (sub === "global" || isGlobalFlag(sub)) {
        return { kind: "global" };
    }
    if (YARN_INSTALL.has(sub)) {
        return parseInstallOrAdd(argv, 2, YARN_ADD_FLAGS, true);
    }
    if (YARN_UNINSTALL.has(sub)) {
        return parseRemove(argv, 2);
    }
    if (sub === "run") {
        return parseRun(argv, 2);
    }
    if (sub === "exec") {
        return parseExec(argv, 2, false);
    }
    if (sub === "dlx") {
        return parseExec(argv, 2, true);
    }
    const lifecycle = LIFECYCLE[sub];
    if (lifecycle !== undefined) {
        return lifecycleAction(argv, 1, lifecycle);
    }
    if (isOption(sub)) {
        return parseInstallOrAdd(argv, 1, YARN_ADD_FLAGS, true);
    }
    return YARN_BUILTINS.has(sub) ? { kind: "other" } : parseRun(argv, 1);
}

function bunAction(argv: readonly CallArg[]): NodeAction {
    const sub = argv[1]?.value;
    if (sub === undefined) {
        return { kind: "other" };
    }
    if (sub === "x") {
        return parseExec(argv, 2, true);
    }
    if (sub === "run") {
        return parseRun(argv, 2);
    }
    if (sub === "global" || isGlobalFlag(sub)) {
        return { kind: "global" };
    }
    if (BUN_INSTALL.has(sub)) {
        return parseInstallOrAdd(argv, 2, BUN_ADD_FLAGS, true);
    }
    if (BUN_UNINSTALL.has(sub)) {
        return parseRemove(argv, 2);
    }
    return { kind: "other" };
}

/** Executable → effective manager and action parser. */
interface CommandSpec {
    readonly manager: NodeManager;
    readonly action: (argv: readonly CallArg[]) => NodeAction;
}

const COMMANDS: Readonly<Record<string, CommandSpec>> = {
    npm: { manager: "npm", action: npmAction },
    npx: { manager: "npm", action: (argv) => parseExec(argv, 1, true) },
    pnpm: { manager: "pnpm", action: pnpmAction },
    pnpx: { manager: "pnpm", action: (argv) => parseExec(argv, 1, true) },
    yarn: { manager: "yarn", action: yarnAction },
    bun: { manager: "bun", action: bunAction },
    bunx: { manager: "bun", action: (argv) => parseExec(argv, 1, true) },
};

/** Parses a Node command line into `{ manager, action }`. */
export function parseNodeCommand(argv: readonly CallArg[]): NodeCommand | undefined {
    const executable = argv[0]?.value;
    const spec = executable === undefined ? undefined : COMMANDS[executable];
    return spec === undefined
        ? undefined
        : { manager: spec.manager, action: spec.action(argv) };
}

/**
 * The tool a script's shebang runs when it is a Node-ecosystem CLI resolved
 * through `env` (`env tsx`, `env ts-node`, `env zx`…). `undefined` for absolute
 * interpreters, Node runtimes/managers, and Python shebangs.
 */
export function nodeScriptTool(shebang: Shebang): string | undefined {
    if (!shebang.viaEnv) {
        return undefined;
    }
    const base = basename(shebang.interpreter);
    if (
        NODE_RUNTIME_TOOLS.has(base) ||
        isPythonInterpreter(base) ||
        pythonManagerOf(base) !== undefined
    ) {
        return undefined;
    }
    return base;
}

/** How a binary is reached: already installed, or downloaded on demand. */
export type ExecKind = "installed" | "download";

/** Rendering options that depend on the project, not the command. */
export interface NodeDialectContext {
    /** How the rule decided to reach an `exec` binary. */
    readonly exec: ExecKind;
    readonly yarnBerry: boolean;
}

/** Renders a `NodeCommand` for one manager as replacement words. */
export interface NodeDialect {
    readonly manager: NodeManager;
    render(command: NodeCommand, context: NodeDialectContext): readonly Replacement[];
    /**
     * The words that run a binary, or `undefined` when the target cannot do it
     * for `withPackages` (bun's `x`).
     */
    execPrefix(
        kind: ExecKind,
        yarnBerry: boolean,
        withPackages: boolean,
    ): readonly string[] | undefined;
}

interface DialectConfig {
    readonly manager: NodeManager;
    readonly install: readonly string[];
    readonly ci: (yarnBerry: boolean) => readonly string[];
    readonly add: readonly string[];
    readonly addDev: string;
    readonly addExact: string;
    readonly addOptional: string;
    readonly remove: readonly string[];
    readonly runSeparator: boolean;
    readonly packageFlag: string;
    readonly exec: (
        kind: ExecKind,
        yarnBerry: boolean,
        withPackages: boolean,
    ) => readonly string[] | undefined;
}

function packageRefs(indices: readonly number[]): Replacement[] {
    return indices.map((index) => arg(index));
}

function runRefs(
    action: Extract<NodeAction, { kind: "run" }>,
    separator: boolean,
): Replacement[] {
    if (action.args.length === 0) {
        return [];
    }
    return separator
        ? [...text("--"), ...packageRefs(action.args)]
        : packageRefs(action.args);
}

function addFlags(
    action: Extract<NodeAction, { kind: "add" }>,
    config: DialectConfig,
): Replacement[] {
    const flags: Replacement[] = [];
    if (action.dev) {
        flags.push(...text(config.addDev));
    }
    if (action.exact) {
        flags.push(...text(config.addExact));
    }
    if (action.optional) {
        flags.push(...text(config.addOptional));
    }
    return flags;
}

class TableDialect implements NodeDialect {
    constructor(private readonly config: DialectConfig) {}

    get manager(): NodeManager {
        return this.config.manager;
    }

    execPrefix(
        kind: ExecKind,
        yarnBerry: boolean,
        withPackages: boolean,
    ): readonly string[] | undefined {
        return this.config.exec(kind, yarnBerry, withPackages);
    }

    render(command: NodeCommand, context: NodeDialectContext): Replacement[] {
        const action = command.action;
        switch (action.kind) {
            case "install":
                return [...text(...this.config.install)];
            case "ci":
                return [...text(...this.config.ci(context.yarnBerry))];
            case "add":
                return [
                    ...text(...this.config.add),
                    ...addFlags(action, this.config),
                    ...packageRefs(action.packages),
                ];
            case "remove":
                return [
                    ...text(...this.config.remove),
                    ...packageRefs(action.packages),
                ];
            case "run":
                return [
                    ...text(this.config.manager, "run"),
                    action.scriptName === undefined
                        ? arg(action.script)
                        : { kind: "text", value: action.scriptName },
                    ...runRefs(action, this.config.runSeparator),
                ];
            case "exec":
                return this.renderExec(action, context);
            default:
                return [];
        }
    }

    private renderExec(
        action: Extract<NodeAction, { kind: "exec" }>,
        context: NodeDialectContext,
    ): Replacement[] {
        const withPackages = action.packages.length > 0;
        const prefix = this.config.exec(context.exec, context.yarnBerry, withPackages);
        if (prefix === undefined) {
            return [];
        }
        const argv = [...text(...prefix)];
        if (withPackages) {
            for (const pkg of action.packages) {
                argv.push(...text(this.config.packageFlag), arg(pkg));
            }
        }
        argv.push(arg(action.binary), ...packageRefs(action.args));
        return argv;
    }
}

/**
 * Exec prefixes. `withPackages` means a `-p`/`--package` was given, which
 * implies a fetch and drops the npm/yarn `-y`.
 */
function npxPrefix(kind: ExecKind, withPackages: boolean): readonly string[] {
    if (withPackages) {
        return ["npx"];
    }
    return kind === "download" ? ["npx", "-y"] : ["npx"];
}

const NPM_EXEC = (
    kind: ExecKind,
    _yarnBerry: boolean,
    withPackages: boolean,
): readonly string[] => npxPrefix(kind, withPackages);

const PNPM_EXEC = (
    kind: ExecKind,
    _yarnBerry: boolean,
    withPackages: boolean,
): readonly string[] =>
    withPackages || kind === "download" ? ["pnpm", "dlx"] : ["pnpm", "exec"];

const YARN_EXEC = (
    kind: ExecKind,
    yarnBerry: boolean,
    withPackages: boolean,
): readonly string[] => {
    if (!yarnBerry) {
        return npxPrefix(kind, withPackages);
    }
    return withPackages || kind === "download" ? ["yarn", "dlx"] : ["yarn", "exec"];
};

const BUN_EXEC = (
    _kind: ExecKind,
    _yarnBerry: boolean,
    withPackages: boolean,
): readonly string[] | undefined => (withPackages ? undefined : ["bunx"]);

const DIALECTS: Readonly<Record<NodeManager, NodeDialect>> = Object.freeze({
    npm: new TableDialect({
        manager: "npm",
        install: ["npm", "install"],
        ci: () => ["npm", "ci"],
        add: ["npm", "install"],
        addDev: "-D",
        addExact: "-E",
        addOptional: "-O",
        remove: ["npm", "uninstall"],
        runSeparator: true,
        packageFlag: "-p",
        exec: NPM_EXEC,
    }),
    pnpm: new TableDialect({
        manager: "pnpm",
        install: ["pnpm", "install"],
        ci: () => ["pnpm", "install", "--frozen-lockfile"],
        add: ["pnpm", "add"],
        addDev: "-D",
        addExact: "-E",
        addOptional: "-O",
        remove: ["pnpm", "remove"],
        runSeparator: false,
        packageFlag: "--package",
        exec: PNPM_EXEC,
    }),
    yarn: new TableDialect({
        manager: "yarn",
        install: ["yarn", "install"],
        ci: (berry) =>
            berry
                ? ["yarn", "install", "--immutable"]
                : ["yarn", "install", "--frozen-lockfile"],
        add: ["yarn", "add"],
        addDev: "-D",
        addExact: "-E",
        addOptional: "-O",
        remove: ["yarn", "remove"],
        runSeparator: false,
        packageFlag: "-p",
        exec: YARN_EXEC,
    }),
    bun: new TableDialect({
        manager: "bun",
        install: ["bun", "install"],
        ci: () => ["bun", "install", "--frozen-lockfile"],
        add: ["bun", "add"],
        addDev: "-d",
        addExact: "--exact",
        addOptional: "--optional",
        remove: ["bun", "remove"],
        runSeparator: false,
        packageFlag: "--package",
        exec: BUN_EXEC,
    }),
});

export function nodeDialect(manager: NodeManager): NodeDialect {
    return DIALECTS[manager];
}
