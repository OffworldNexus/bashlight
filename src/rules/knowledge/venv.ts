/**
 * Whether `argv[0]` names an executable inside a virtualenv's `bin` directory.
 *
 * Such a path already points at the exact interpreter or console script the
 * project wants; running it through a runner (`uv run python .venv/bin/pytest`)
 * or re-resolving its shebang would be wrong. Every rule checks this before it
 * resolves a shebang, so an explicit venv executable is always left untouched.
 *
 * A venv is recognized either as the project's detected virtualenv or, more
 * generally, by the `pyvenv.cfg` sitting next to the `bin` directory.
 */
import { basename, dirname, isInside, join, resolve } from "../../shared/posix-path.ts";
import type { CommandCall, RuleContext } from "../rule.ts";

const VENV_MARKER = "pyvenv.cfg";
const BIN = "bin";

export function isVenvExecutable(call: CommandCall, context: RuleContext): boolean {
    const value = call.argv[0]?.value;
    if (value === undefined || !value.includes("/")) {
        return false;
    }
    const path = resolve(context.cwd, value);
    if (path === undefined) {
        return false;
    }
    const bin = dirname(path);
    if (basename(bin) !== BIN) {
        return false;
    }
    const project = context.project.python(bin);
    if (project?.venv !== undefined && isInside(path, join(project.venv, BIN))) {
        return true;
    }
    return context.files.exists(join(dirname(bin), VENV_MARKER));
}
