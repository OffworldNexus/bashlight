/* eslint-disable sonarjs/function-return-type */
/**
 * One reading of a Python command line: which runner (if any) prefixes it and
 * which Python tool it ends up executing.
 *
 * This is the single place that knows how `poetry run`, `uv run`,
 * `.venv/bin/python` or a bare `pytest` look, so the Python rules share it
 * instead of each re-parsing argv.
 */
import type { EnvironmentView } from "../../interp/context.ts";
import {
    PYTHON_MANAGERS,
    type PythonManager,
    type Shebang,
} from "../../project/index.ts";
import { basename, dirname } from "../../shared/posix-path.ts";
import type { CallArg } from "../rule.ts";
import type { ResolvedScript } from "./script-resolver.ts";
import { isOption } from "./words.ts";

/** A manager whose `run` subcommand executes a command in the project env. */
export type PythonRunnerManager = Exclude<PythonManager, "venv">;

/** The managers that can prefix a command, in vocabulary order. */
export const RUNNER_MANAGERS: readonly PythonRunnerManager[] = PYTHON_MANAGERS.filter(
    (manager): manager is PythonRunnerManager => manager !== "venv",
);

/** How the Python tool is reached. */
export type PythonRunner =
    | { readonly kind: "bare" }
    /** `<manager> run …` (plus the manager's own prefix options). */
    | {
          readonly kind: "manager";
          readonly manager: PythonRunnerManager;
          /** Number of argv words taken by the runner prefix. */
          readonly length: number;
          /** Whether the prefix carried options (making a swap unsafe). */
          readonly hasOptions: boolean;
      }
    /** An explicit path to an executable, venv or not. */
    | {
          readonly kind: "path";
          /** Directory part of the path (e.g. `.venv/bin`, `/usr/bin`). */
          readonly directory: string;
          /** Whether the directory looks like a virtualenv `bin`. */
          readonly isVenvBin: boolean;
      }
    /** A script file whose shebang runs a Python interpreter or a runner. */
    | { readonly kind: "script"; readonly shebang: Shebang };

export interface PythonCommand {
    readonly runner: PythonRunner;
    /**
     * The effective Python tool: `python` for an interpreter, the module name
     * for `python -m X`, or the command word (`pytest`, `pip`, …) otherwise.
     */
    readonly tool: string;
    /** Index of the word the tool was read from (the interpreter for `-m`). */
    readonly toolIndex: number;
    /** Whether the tool was reached through `python -m`. */
    readonly viaModule: boolean;
}

const INTERPRETER = /^python(3(?:\.\d+)?)?$/;
const PIP = /^pip(?:3(?:\.\d+)?)?$/;
/** `python3.N` is the only version form we translate. */
const VERSIONED_INTERPRETER = /^python(3\.\d+)$/;

/** Well-known Python CLI tools, mapped to the package that provides them. */
export const PYTHON_TOOLS: Readonly<Record<string, string>> = Object.freeze({
    pytest: "pytest",
    "py.test": "pytest",
    mypy: "mypy",
    dmypy: "mypy",
    ruff: "ruff",
    black: "black",
    isort: "isort",
    flake8: "flake8",
    pylint: "pylint",
    pyright: "pyright",
    "django-admin": "django",
    alembic: "alembic",
    ipython: "ipython",
    coverage: "coverage",
    uvicorn: "uvicorn",
    gunicorn: "gunicorn",
    celery: "celery",
    "sphinx-build": "sphinx",
    mkdocs: "mkdocs",
    jupyter: "jupyter",
    "pre-commit": "pre-commit",
    tox: "tox",
    nox: "nox",
});

/** Modules that create environments: never wrapped in the project runner. */
export const VENV_MODULES: ReadonlySet<string> = new Set(["venv", "virtualenv"]);

export function isPythonInterpreter(name: string | undefined): boolean {
    return name !== undefined && INTERPRETER.test(name);
}

export function isPipTool(name: string | undefined): boolean {
    return name !== undefined && PIP.test(name);
}

/** The package providing `tool`, when it is a well-known Python CLI tool. */
export function knownPythonPackage(tool: string): string | undefined {
    if (PYTHON_TOOLS[tool] !== undefined) {
        return PYTHON_TOOLS[tool];
    }
    return isPipTool(tool) ? "pip" : undefined;
}

export function isVenvModule(tool: string): boolean {
    return VENV_MODULES.has(tool);
}

/** `3.N` for `python3.N`, otherwise `undefined`. */
export function interpreterVersion(name: string): string | undefined {
    return VERSIONED_INTERPRETER.exec(name)?.[1];
}

/**
 * Whether a virtualenv is active. `VIRTUAL_ENV` is set by `activate`;
 * `CONDA_PREFIX` is set by `conda activate` (the interpreter reports it as
 * unknown, which still means "active").
 */
export function isVenvActive(env: EnvironmentView): boolean {
    return (
        env.lookup("VIRTUAL_ENV").kind !== "unset" ||
        env.lookup("CONDA_PREFIX").kind !== "unset"
    );
}

/** Where the pip subcommand of a `pip` invocation sits, if it is one. */
export interface PipSubcommand {
    /** Index of the `pip` word itself. */
    readonly pipIndex: number;
    /** Index of the subcommand word (`install`, `list`…). */
    readonly index: number;
    readonly name: string;
}

export function isPipCommand(command: PythonCommand): boolean {
    return command.viaModule ? command.tool === "pip" : isPipTool(command.tool);
}

export function pipSubcommand(
    argv: readonly CallArg[],
    command: PythonCommand,
): PipSubcommand | undefined {
    if (!isPipCommand(command)) {
        return undefined;
    }
    const pipIndex = command.viaModule ? command.toolIndex + 2 : command.toolIndex;
    const name = argv[pipIndex + 1]?.value;
    if (name === undefined) {
        return undefined;
    }
    return { pipIndex, index: pipIndex + 1, name };
}

export function isPipInstallOrUninstall(
    argv: readonly CallArg[],
    command: PythonCommand,
): boolean {
    const name = pipSubcommand(argv, command)?.name;
    return name === "install" || name === "uninstall";
}

const UV_RUN_VALUE_OPTIONS: readonly string[] = [
    "--with",
    "--with-requirements",
    "--python",
    "-p",
    "--project",
    "--directory",
    "--extra",
    "--group",
    "--package",
    "--env-file",
    "--index",
];

const UV_RUN_FLAG_OPTIONS: ReadonlySet<string> = new Set([
    "--no-sync",
    "--frozen",
    "--locked",
    "--isolated",
    "--all-extras",
    "--no-dev",
    "--active",
    "-q",
    "-v",
    "--quiet",
]);

const POETRY_PREFIX_VALUE_OPTIONS: readonly string[] = ["-C", "--directory"];

interface Prefix {
    readonly length: number;
    readonly hasOptions: boolean;
}

/** Skips a value-taking option at `index`, returning the next index. */
function skipValueOption(
    argv: readonly CallArg[],
    index: number,
    names: readonly string[],
): number | undefined {
    const value = argv[index]?.value;
    if (value === undefined) {
        return undefined;
    }
    for (const name of names) {
        if (value === name) {
            return argv[index + 1] === undefined ? undefined : index + 2;
        }
        if (value.startsWith(`${name}=`)) {
            return index + 1;
        }
    }
    return undefined;
}

function parsePoetryPrefix(argv: readonly CallArg[]): Prefix | undefined {
    let index = 1;
    let hasOptions = false;
    for (;;) {
        const next = skipValueOption(argv, index, POETRY_PREFIX_VALUE_OPTIONS);
        if (next === undefined) {
            break;
        }
        index = next;
        hasOptions = true;
    }
    if (argv[index]?.value !== "run") {
        return undefined;
    }
    return { length: index + 1, hasOptions };
}

function parseUvPrefix(argv: readonly CallArg[]): Prefix | undefined {
    if (argv[1]?.value !== "run") {
        return undefined;
    }
    let index = 2;
    let hasOptions = false;
    for (;;) {
        const value = argv[index]?.value;
        if (value === undefined) {
            break;
        }
        const next = skipValueOption(argv, index, UV_RUN_VALUE_OPTIONS);
        if (next !== undefined) {
            index = next;
            hasOptions = true;
            continue;
        }
        if (UV_RUN_FLAG_OPTIONS.has(value)) {
            index += 1;
            hasOptions = true;
            continue;
        }
        if (isOption(value)) {
            return undefined;
        }
        break;
    }
    return { length: index, hasOptions };
}

function parseManagerPrefix(
    argv: readonly CallArg[],
    manager: PythonRunnerManager,
): Prefix | undefined {
    if (manager === "poetry") {
        return parsePoetryPrefix(argv);
    }
    if (manager === "uv") {
        return parseUvPrefix(argv);
    }
    if (argv[1]?.value !== "run") {
        return undefined;
    }
    return { length: 2, hasOptions: false };
}

/** True when `directory` looks like a virtualenv `bin` directory. */
function looksLikeVenvBin(directory: string): boolean {
    const segments = directory.split("/").filter((part) => part !== "" && part !== ".");
    const last = segments[segments.length - 1];
    const previous = segments[segments.length - 2];
    return last === "bin" && previous !== undefined && /venv/i.test(previous);
}

/**
 * Reads the tool executed by argv, starting at `commandIndex` under `runner`.
 * Any command word is accepted under a manager runner (rules decide whether it
 * is Python); bare calls must name a Python tool.
 */
function readTool(
    argv: readonly CallArg[],
    commandIndex: number,
    runner: PythonRunner,
    word = argv[commandIndex]?.value,
): PythonCommand | undefined {
    if (word === undefined) {
        return undefined;
    }
    if (isPythonInterpreter(word)) {
        if (argv[commandIndex + 1]?.value === "-m") {
            const module = argv[commandIndex + 2]?.value;
            if (module !== undefined) {
                return {
                    runner,
                    tool: module,
                    toolIndex: commandIndex,
                    viaModule: true,
                };
            }
        }
        return { runner, tool: "python", toolIndex: commandIndex, viaModule: false };
    }
    if (isPipTool(word) || knownPythonPackage(word) !== undefined) {
        return { runner, tool: word, toolIndex: commandIndex, viaModule: false };
    }
    if (runner.kind === "manager") {
        return { runner, tool: word, toolIndex: commandIndex, viaModule: false };
    }
    return undefined;
}

function parseManager(
    argv: readonly CallArg[],
    manager: PythonRunnerManager,
): PythonCommand | undefined {
    if (manager === "uv" && argv[1]?.value === "pip") {
        return readTool(argv, 1, {
            kind: "manager",
            manager,
            length: 1,
            hasOptions: false,
        });
    }
    const prefix = parseManagerPrefix(argv, manager);
    if (prefix === undefined) {
        return undefined;
    }
    return readTool(argv, prefix.length, {
        kind: "manager",
        manager,
        length: prefix.length,
        hasOptions: prefix.hasOptions,
    });
}

function parsePath(argv: readonly CallArg[]): PythonCommand | undefined {
    const word = argv[0]?.value;
    if (word === undefined) {
        return undefined;
    }
    const directory = dirname(word);
    const base = basename(word);
    if (
        !isPythonInterpreter(base) &&
        !isPipTool(base) &&
        knownPythonPackage(base) === undefined
    ) {
        return undefined;
    }
    const runner: PythonRunner = {
        kind: "path",
        directory,
        isVenvBin: looksLikeVenvBin(directory),
    };
    return readTool(argv, 0, runner, base);
}

function parseBare(argv: readonly CallArg[]): PythonCommand | undefined {
    const word = argv[0]?.value;
    if (word === undefined) {
        return undefined;
    }
    if (
        !isPythonInterpreter(word) &&
        !isPipTool(word) &&
        knownPythonPackage(word) === undefined
    ) {
        return undefined;
    }
    return readTool(argv, 0, { kind: "bare" });
}

/** The `PythonRunnerManager` named `name`, if any. */
export function pythonManagerOf(name: string): PythonRunnerManager | undefined {
    return RUNNER_MANAGERS.includes(name as PythonRunnerManager)
        ? (name as PythonRunnerManager)
        : undefined;
}

/** The Python interpreter a shebang names (`python3`, `/usr/bin/python3`). */
export function shebangPythonBase(shebang: Shebang): string | undefined {
    const base = basename(shebang.interpreter);
    return isPythonInterpreter(base) ? base : undefined;
}

/** The runner a shebang itself uses (`env -S uv run --script` → `uv`). */
export function shebangManager(shebang: Shebang): PythonRunnerManager | undefined {
    return pythonManagerOf(basename(shebang.interpreter));
}

/** A script whose shebang runs Python (directly or through a runner). */
function parseScript(script: ResolvedScript): PythonCommand | undefined {
    const shebang = script.shebang;
    if (
        shebangPythonBase(shebang) !== undefined ||
        shebangManager(shebang) !== undefined
    ) {
        return {
            runner: { kind: "script", shebang },
            tool: "python",
            toolIndex: 0,
            viaModule: false,
        };
    }
    return undefined;
}

/**
 * Parses a Python command line into `{ runner, tool, toolIndex, viaModule }`.
 *
 * `script` is the already-resolved shebang of `argv[0]` when it is a script
 * path (see `resolveScript`); it takes precedence over path parsing.
 */
export function parsePythonCommand(
    argv: readonly CallArg[],
    script?: ResolvedScript,
): PythonCommand | undefined {
    const first = argv[0]?.value;
    if (first === undefined) {
        return undefined;
    }
    if (script !== undefined) {
        return parseScript(script);
    }
    const manager = pythonManagerOf(first);
    if (manager !== undefined) {
        return parseManager(argv, manager);
    }
    if (first.includes("/")) {
        return parsePath(argv);
    }
    return parseBare(argv);
}
