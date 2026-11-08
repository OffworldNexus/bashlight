/* eslint-disable sonarjs/cognitive-complexity, sonarjs/function-return-type */
/**
 * Runs Python commands through the project's own runner: `poetry run`,
 * `uv run`, `pipenv run`, `pdm run`, `hatch run`, or the project venv's `bin`
 * when the project only has a plain virtualenv. Also swaps a wrong runner for
 * the project's one, and resolves scripts through their shebang.
 */
import type { PythonToolchain } from "../../project/index.ts";
import { basename, isInside, join, relative } from "../../shared/posix-path.ts";
import {
    interpreterVersion,
    isPipCommand,
    isPipInstallOrUninstall,
    isPythonInterpreter,
    isVenvActive,
    isVenvModule,
    knownPythonPackage,
    parsePythonCommand,
    type PythonCommand,
    shebangManager,
    shebangPythonBase,
} from "../knowledge/python-command-line.ts";
import { resolveScript } from "../knowledge/script-resolver.ts";
import type { CommandCall, Rule, RuleContext, Verdict } from "../rule.ts";
import { argsFrom, keep, replace, text } from "../verdict.ts";

export class PythonRunnerRule implements Rule {
    readonly id = "python-runner";
    readonly scope = "local";

    inspect(call: CommandCall, context: RuleContext): Verdict {
        if (context.cwd === undefined) {
            return keep();
        }
        const project = context.project.python(context.cwd);
        if (project === undefined) {
            return keep();
        }
        if (isVenvActive(call.env)) {
            return keep();
        }
        const script = resolveScript(call, context);
        const python = parsePythonCommand(call.argv, script);
        if (python === undefined || python.runner.kind === "path") {
            return keep();
        }
        if (python.runner.kind === "script") {
            return scriptVerdict(call, python, project, context.cwd);
        }
        if (python.viaModule && isVenvModule(python.tool)) {
            return keep();
        }
        if (isPipInstallOrUninstall(call.argv, python)) {
            return keep();
        }
        if (python.runner.kind === "manager") {
            if (python.runner.manager === project.manager) {
                return keep();
            }
            if (python.runner.hasOptions) {
                return keep();
            }
            if (!this.shouldWrap(call, python, project, true)) {
                return keep();
            }
            return this.rewrite(call, python, project, context.cwd);
        }
        if (!this.shouldWrap(call, python, project, false)) {
            return keep();
        }
        return this.rewrite(call, python, project, context.cwd);
    }

    private shouldWrap(
        call: CommandCall,
        python: PythonCommand,
        project: PythonToolchain,
        underRunner: boolean,
    ): boolean {
        const word = call.argv[python.toolIndex]?.value;
        if (isPythonInterpreter(word) || isPipCommand(python)) {
            return true;
        }
        const pkg = knownPythonPackage(python.tool);
        if (pkg !== undefined) {
            return underRunner || project.declares(pkg);
        }
        return underRunner && project.declares(python.tool);
    }

    private rewrite(
        call: CommandCall,
        python: PythonCommand,
        project: PythonToolchain,
        cwd: string,
    ): Verdict {
        if (project.manager === "venv") {
            const word = call.argv[python.toolIndex]?.value;
            if (word === undefined) {
                return keep();
            }
            const name = isPythonInterpreter(word)
                ? venvInterpreterName(word)
                : basename(word);
            const path = venvExecutablePath(project, cwd, name);
            if (path === undefined) {
                return keep();
            }
            return replace(
                [
                    { kind: "text", value: path },
                    ...argsFrom(call.argv, python.toolIndex + 1),
                ],
                `run through ${path}`,
            );
        }
        return replace(
            [...text(project.manager, "run"), ...argsFrom(call.argv, python.toolIndex)],
            `run through \`${project.manager} run\``,
        );
    }
}

/**
 * A script whose shebang runs Python. An `env`-style shebang is `PATH`-scoped,
 * so prefixing the runner is enough; an absolute interpreter bypasses `PATH`,
 * so `python` is inserted explicitly.
 */
function scriptVerdict(
    call: CommandCall,
    python: PythonCommand,
    project: PythonToolchain,
    cwd: string,
): Verdict {
    if (python.runner.kind !== "script") {
        return keep();
    }
    const shebang = python.runner.shebang;
    const pythonBase = shebangPythonBase(shebang);
    if (pythonBase !== undefined) {
        if (project.manager === "venv") {
            const path = venvExecutablePath(
                project,
                cwd,
                venvInterpreterName(pythonBase),
            );
            if (path === undefined) {
                return keep();
            }
            return replace(
                [{ kind: "text", value: path }, ...argsFrom(call.argv, 0)],
                `run through ${path}`,
            );
        }
        const prefix = shebang.viaEnv
            ? text(project.manager, "run")
            : [...text(project.manager, "run"), ...text("python")];
        return replace(
            [...prefix, ...argsFrom(call.argv, 0)],
            `run through \`${project.manager} run\``,
        );
    }
    const manager = shebangManager(shebang);
    if (manager !== undefined && manager !== project.manager) {
        return replace(
            [...text(project.manager, "run"), ...argsFrom(call.argv, 0)],
            `run through \`${project.manager} run\``,
        );
    }
    return keep();
}

/** The venv `bin` path for an executable, relative to cwd when inside. */
function venvExecutablePath(
    project: PythonToolchain,
    cwd: string,
    name: string,
): string | undefined {
    if (project.venv === undefined) {
        return undefined;
    }
    const absolute = join(project.venv, "bin", name);
    return isInside(cwd, project.root) ? relative(cwd, absolute) : absolute;
}

/**
 * The interpreter to use inside a venv: keep `python`/`python3`, but a
 * versioned `python3.N` may not exist there, so fall back to `python` (we
 * cannot check the venv's `bin` from here).
 */
function venvInterpreterName(word: string): string {
    return interpreterVersion(word) === undefined ? word : "python";
}
