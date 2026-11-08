/**
 * Outside any Python project, route Python invocations through `uv` (which
 * understands PEP 723 inline metadata) and refuse `pip install`, whose only
 * safe home is a project or a throwaway `uv run` environment.
 *
 * Because a bare `uv run python` gets an empty ephemeral environment, the rule
 * also reads the code it is about to run — a `-c` snippet, a script file, a
 * heredoc or herestring on stdin, or a `-m` module — and adds a `--with <dist>`
 * for every third-party module it imports, so that probing a module and then
 * using it both work.
 */
import type { PythonManager } from "../../project/index.ts";
import { dirname, join, relative, resolve } from "../../shared/posix-path.ts";
import {
    interpreterVersion,
    isPipCommand,
    isPythonInterpreter,
    isVenvActive,
    isVenvModule,
    parsePythonCommand,
    pipSubcommand,
    type PythonCommand,
    shebangPythonBase,
} from "../knowledge/python-command-line.ts";
import {
    distributionFor,
    hasPep723Block,
    isStdlibModule,
    PythonImportScanner,
} from "../knowledge/python-imports.ts";
import { resolveScript } from "../knowledge/script-resolver.ts";
import { isVenvExecutable } from "../knowledge/venv.ts";
import { isOption } from "../knowledge/words.ts";
import type { CallArg, CommandCall, Rule, RuleContext, Verdict } from "../rule.ts";
import { argsFrom, block, keep, replace, text } from "../verdict.ts";

export const PIP_OUTSIDE_PROJECT_MESSAGE =
    "Installing packages with pip outside a project is disabled. Use a PEP 723 " +
    "script (`# /// script` with `dependencies = [...]`) run with `uv run " +
    "script.py`, `uv run --with <pkg> python …` for one-offs, or `uvx <tool>` " +
    "for command-line tools.";

const UV_REASON = "run with uv";

/** Past this many dependencies it is not a quick probe; keep the plain run. */
const MAX_WITH = 10;

/** Scripts are read up to this size when looking for imports. */
const SCRIPT_MAX_BYTES = 256 * 1024;

export class BarePythonRule implements Rule {
    readonly id = "bare-python";
    readonly scope = "local";
    private readonly imports = new PythonImportScanner();

    inspect(call: CommandCall, context: RuleContext): Verdict {
        if (context.cwd === undefined) {
            return keep();
        }
        if (isVenvExecutable(call, context)) {
            return keep();
        }
        if (context.project.python(context.cwd) !== undefined) {
            return keep();
        }
        if (isVenvActive(call.env)) {
            return keep();
        }
        const script = resolveScript(call, context);
        const python = parsePythonCommand(call.argv, script);
        if (python === undefined) {
            return keep();
        }
        if (python.runner.kind === "script") {
            return this.script(call, python);
        }
        if (python.runner.kind !== "bare") {
            return keep();
        }
        if (python.viaModule && isVenvModule(python.tool)) {
            return keep();
        }
        if (isPipCommand(python)) {
            return this.pip(call, python, context);
        }
        if (!isPythonInterpreter(call.argv[python.toolIndex]?.value)) {
            return keep();
        }
        return this.interpreter(call, python, context);
    }

    /** A Python-shebang script runs under `uv` like `python script.py` does. */
    private script(call: CommandCall, python: PythonCommand): Verdict {
        if (python.runner.kind !== "script") {
            return keep();
        }
        const shebang = python.runner.shebang;
        if (shebangPythonBase(shebang) === undefined) {
            return keep();
        }
        // An absolute interpreter bypasses PATH, so `uv` needs `python` named.
        const prefix = shebang.viaEnv
            ? [...text("uv", "run")]
            : [...text("uv", "run", "python")];
        return replace([...prefix, ...argsFrom(call.argv, 0)], UV_REASON);
    }

    private pip(
        call: CommandCall,
        python: PythonCommand,
        context: RuleContext,
    ): Verdict {
        const info = pipSubcommand(call.argv, python);
        if (info?.name !== "install") {
            return keep();
        }
        return block(this.pipMessage(call, context));
    }

    /** Point at a child project when the cwd itself is only a monorepo root. */
    private pipMessage(call: CommandCall, context: RuleContext): string {
        const project =
            context.cwd === undefined
                ? undefined
                : findChildProject(context.cwd, context);
        if (project === undefined) {
            return PIP_OUTSIDE_PROJECT_MESSAGE;
        }
        const command = shellWords(call.argv);
        return (
            `This directory is not a Python project, but ${project.relative}/ ` +
            `is (${MANAGER_LABELS[project.manager]}). Run it there: ` +
            `\`cd ${project.relative} && ${command}\` — bashlight will use the ` +
            "project's own tool."
        );
    }

    private interpreter(
        call: CommandCall,
        python: PythonCommand,
        context: RuleContext,
    ): Verdict {
        const name = call.argv[python.toolIndex]?.value;
        if (name === undefined) {
            return keep();
        }
        const version = interpreterVersion(name);
        const prefix = [...text("uv", "run")];
        if (version !== undefined) {
            prefix.push(...text("--python", version));
        }
        for (const distribution of this.distributions(call, python, context)) {
            prefix.push(...text("--with", distribution));
        }
        const next = call.argv[python.toolIndex + 1]?.value;
        const rest = argsFrom(call.argv, python.toolIndex + 1);
        if (isScript(next)) {
            return replace([...prefix, ...rest], UV_REASON);
        }
        return replace([...prefix, ...text("python"), ...rest], UV_REASON);
    }

    /** The third-party distributions the code about to run will need. */
    private distributions(
        call: CommandCall,
        python: PythonCommand,
        context: RuleContext,
    ): readonly string[] {
        const next = call.argv[python.toolIndex + 1]?.value;
        if (next === "-c") {
            const code = call.argv[python.toolIndex + 2]?.value;
            return code === undefined
                ? []
                : this.forModules(this.scan(code), context.cwd, context);
        }
        if (next === "-m") {
            const module = topLevel(call.argv[python.toolIndex + 2]?.value);
            return module === undefined
                ? []
                : this.forModules([module], context.cwd, context);
        }
        if (next === undefined || next === "-") {
            const stdin = call.stdin;
            return stdin === undefined
                ? []
                : this.forModules(this.scan(stdin), context.cwd, context);
        }
        if (isScript(next)) {
            return this.forScript(next, context);
        }
        return [];
    }

    /** Top-level third-party modules imported by a script file on disk. */
    private forScript(script: string, context: RuleContext): readonly string[] {
        const path = resolve(context.cwd, script);
        if (path === undefined) {
            return [];
        }
        const text = context.files.readHead(path, SCRIPT_MAX_BYTES);
        if (text === undefined || hasPep723Block(text)) {
            return [];
        }
        return this.forModules(this.scan(text), dirname(path), context);
    }

    private scan(code: string): readonly string[] {
        return this.imports.scan(code);
    }

    /**
     * Distributions for these module names, skipping stdlib and local modules,
     * mapping import names to their distributions, and giving up past the cap.
     */
    private forModules(
        modules: readonly string[],
        baseDir: string | undefined,
        context: RuleContext,
    ): readonly string[] {
        const distributions: string[] = [];
        const seen = new Set<string>();
        for (const module of modules) {
            if (isStdlibModule(module) || isLocalModule(module, baseDir, context)) {
                continue;
            }
            const distribution = distributionFor(module);
            if (distribution === undefined || seen.has(distribution)) {
                continue;
            }
            seen.add(distribution);
            distributions.push(distribution);
            if (distributions.length > MAX_WITH) {
                return [];
            }
        }
        return distributions;
    }
}

/** A first argument that names a Python script rather than a flag. */
function isScript(value: string | undefined): boolean {
    if (value === undefined || isOption(value)) {
        return false;
    }
    return value.endsWith(".py") || value.endsWith(".pyw") || value.includes("/");
}

/** The top-level name of a possibly dotted module (`json.tool` → `json`). */
function topLevel(name: string | undefined): string | undefined {
    const top = name?.split(".")[0]?.trim();
    return top === undefined || top === "" ? undefined : top;
}

/** Whether a local `<name>.py` or `<name>/` shadows a third-party import. */
function isLocalModule(
    module: string,
    baseDir: string | undefined,
    context: RuleContext,
): boolean {
    if (baseDir === undefined) {
        return false;
    }
    return (
        context.files.exists(join(baseDir, `${module}.py`)) ||
        context.files.isDirectory(join(baseDir, module))
    );
}

/** How many directory levels below the cwd we search for a Python project. */
const MAX_PROJECT_DEPTH = 2;

/** Vendored or throwaway directories never hold the project the agent wants. */
const SKIP_DIRECTORIES: ReadonlySet<string> = new Set([
    "node_modules",
    ".venv",
    "venv",
    "__pycache__",
]);

const MANAGER_LABELS: Readonly<Record<PythonManager, string>> = {
    poetry: "Poetry",
    uv: "uv",
    pipenv: "Pipenv",
    pdm: "PDM",
    hatch: "Hatch",
    venv: "virtualenv",
};

interface ChildProject {
    /** Path of the project, relative to the cwd. */
    readonly relative: string;
    readonly manager: PythonManager;
}

/** The first Python project root within {@link MAX_PROJECT_DEPTH} below `cwd`. */
// eslint-disable-next-line sonarjs/function-return-type
function findChildProject(cwd: string, context: RuleContext): ChildProject | undefined {
    let level: string[] = [cwd];
    for (let depth = 0; depth < MAX_PROJECT_DEPTH; depth += 1) {
        const next: string[] = [];
        for (const dir of level) {
            for (const child of childDirectories(dir, context)) {
                const manager = projectRootAt(child, context);
                if (manager !== undefined) {
                    return { relative: relative(cwd, child), manager };
                }
                next.push(child);
            }
        }
        level = next;
    }
    return undefined;
}

/** The non-hidden, non-vendored sub-directories of `dir`. */
function childDirectories(dir: string, context: RuleContext): readonly string[] {
    return (context.files.listDirectory(dir) ?? [])
        .filter((name) => !name.startsWith(".") && !SKIP_DIRECTORIES.has(name))
        .map((name) => join(dir, name))
        .filter((path) => context.files.isDirectory(path));
}

/** The manager of the project whose root is exactly `dir`. */
function projectRootAt(dir: string, context: RuleContext): PythonManager | undefined {
    const project = context.project.python(dir);
    return project !== undefined && project.root === dir ? project.manager : undefined;
}

/** The command's known arguments joined by spaces, for the block message. */
function shellWords(argv: readonly CallArg[]): string {
    return argv
        .map((argument) => argument.value)
        .filter((value): value is string => value !== undefined)
        .join(" ");
}
