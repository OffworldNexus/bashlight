/* eslint-disable sonarjs/function-return-type */
/**
 * `source`/`.` records the sourced file; when it is a virtualenv `activate`
 * script it models the environment change (`VIRTUAL_ENV`, `PATH`).
 * `deactivate` reverts the PATH it prepended; `conda`/`mamba activate` is
 * handled too.
 */

import { resolve as resolveAgainst } from "../../shared/posix-path.ts";
import type { Builtin, BuiltinInput } from "./types.ts";

/** The `activate` suffix of a virtualenv activation script, if any. */
function activateSuffix(target: string): string | undefined {
    if (target.endsWith("/bin/activate")) {
        return "/bin/activate";
    }
    if (target.endsWith("/activate")) {
        return "/activate";
    }
    return undefined;
}

export class SourceBuiltin implements Builtin {
    readonly names = ["source", "."];

    apply(input: BuiltinInput): void {
        const { scope, store } = input;
        const target = input.argv[1]?.value;
        if (target === undefined) {
            store.setUnknown(scope, "VIRTUAL_ENV", { exported: true });
            store.setUnknown(scope, "PATH", { exported: true });
            return;
        }
        scope.env.sourced.push(target);
        const suffix = activateSuffix(target);
        if (suffix === undefined) {
            return;
        }
        const venv = target.slice(0, target.length - suffix.length) || ".";
        const resolved = resolveAgainst(scope.env.cwd, venv);
        if (resolved === undefined) {
            store.setUnknown(scope, "VIRTUAL_ENV", { exported: true });
            store.setUnknown(scope, "PATH", { exported: true });
            return;
        }
        scope.env.pathBeforeActivate = store.lookupString(scope, "PATH");
        store.setString(scope, "VIRTUAL_ENV", resolved, { exported: true });
        const path = store.lookupString(scope, "PATH");
        if (path === undefined) {
            store.setUnknown(scope, "PATH", { exported: true });
        } else {
            store.setString(scope, "PATH", `${resolved}/bin:${path}`, {
                exported: true,
            });
        }
    }
}

export class DeactivateBuiltin implements Builtin {
    readonly names = ["deactivate"] as const;

    apply(input: BuiltinInput): void {
        const { scope, store } = input;
        const before = scope.env.pathBeforeActivate;
        if (before !== undefined) {
            store.setString(scope, "PATH", before, { exported: true });
        } else {
            const venv = store.lookupString(scope, "VIRTUAL_ENV");
            const path = store.lookupString(scope, "PATH");
            const prefix = venv === undefined ? undefined : `${venv}/bin:`;
            if (prefix !== undefined && path !== undefined && path.startsWith(prefix)) {
                store.setString(scope, "PATH", path.slice(prefix.length), {
                    exported: true,
                });
            }
        }
        store.removeVariable(scope, "VIRTUAL_ENV");
        scope.env.pathBeforeActivate = undefined;
    }
}

export class CondaBuiltin implements Builtin {
    readonly names = ["conda", "mamba"] as const;

    apply(input: BuiltinInput): void {
        if (input.argv[1]?.value !== "activate") {
            return;
        }
        input.store.setUnknown(input.scope, "CONDA_PREFIX", { exported: true });
    }
}
