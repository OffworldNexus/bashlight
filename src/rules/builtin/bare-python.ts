/**
 * Outside any Python project, route Python invocations through `uv` (which
 * understands PEP 723 inline metadata) and refuse `pip install`, whose only
 * safe home is a project or a throwaway `uv run` environment.
 */
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
import { resolveScript } from "../knowledge/script-resolver.ts";
import { isOption } from "../knowledge/words.ts";
import type { CommandCall, Rule, RuleContext, Verdict } from "../rule.ts";
import { argsFrom, block, keep, replace, text } from "../verdict.ts";

export const PIP_OUTSIDE_PROJECT_MESSAGE =
    "Installing packages with pip outside a project is disabled. Use a PEP 723 " +
    "script (`# /// script` with `dependencies = [...]`) run with `uv run " +
    "script.py`, `uv run --with <pkg> python …` for one-offs, or `uvx <tool>` " +
    "for command-line tools.";

const UV_REASON = "run with uv";

export class BarePythonRule implements Rule {
    readonly id = "bare-python";
    readonly scope = "local";

    inspect(call: CommandCall, context: RuleContext): Verdict {
        if (context.cwd === undefined) {
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
            return this.pip(call, python);
        }
        if (!isPythonInterpreter(call.argv[python.toolIndex]?.value)) {
            return keep();
        }
        return this.interpreter(call, python);
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

    private pip(call: CommandCall, python: PythonCommand): Verdict {
        const info = pipSubcommand(call.argv, python);
        if (info?.name !== "install") {
            return keep();
        }
        return block(PIP_OUTSIDE_PROJECT_MESSAGE);
    }

    private interpreter(call: CommandCall, python: PythonCommand): Verdict {
        const name = call.argv[python.toolIndex]?.value;
        if (name === undefined) {
            return keep();
        }
        const version = interpreterVersion(name);
        const next = call.argv[python.toolIndex + 1]?.value;
        const rest = argsFrom(call.argv, python.toolIndex + 1);
        const prefix = [...text("uv", "run")];
        if (version !== undefined) {
            prefix.push(...text("--python", version));
        }
        if (isScript(next)) {
            return replace([...prefix, ...rest], UV_REASON);
        }
        return replace([...prefix, ...text("python"), ...rest], UV_REASON);
    }
}

/** A first argument that names a Python script rather than a flag. */
function isScript(value: string | undefined): boolean {
    if (value === undefined || isOption(value)) {
        return false;
    }
    return value.endsWith(".py") || value.endsWith(".pyw") || value.includes("/");
}
