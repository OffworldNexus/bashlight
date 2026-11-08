/* eslint-disable sonarjs/function-return-type */
/**
 * Resolves `argv[0]` to the script file it names and reads its shebang.
 *
 * This is the single place that turns a relative or absolute script path into
 * the interpreter the kernel would actually run, so every rule can reason
 * about `./manage.py` the same way. It is deliberately conservative: an
 * unknown cwd, an unknown path value, a path without `/`, or a missing shebang
 * all resolve to `undefined` (the rules then keep the command).
 */
import type { Shebang } from "../../project/index.ts";
import { resolve } from "../../shared/posix-path.ts";
import type { CommandCall, RuleContext } from "../rule.ts";

export interface ResolvedScript {
    /** Absolute, `.`/`..` collapsed. */
    readonly path: string;
    readonly shebang: Shebang;
}

/** Resolves `argv[0]` of `call` against `context` and reads its shebang. */
export function resolveScript(
    call: CommandCall,
    context: RuleContext,
): ResolvedScript | undefined {
    const value = call.argv[0]?.value;
    if (value === undefined || !value.includes("/")) {
        return undefined;
    }
    const path = resolve(context.cwd, value);
    if (path === undefined) {
        return undefined;
    }
    const shebang = context.scripts.shebang(path);
    return shebang === undefined ? undefined : { path, shebang };
}
