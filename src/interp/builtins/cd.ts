/** `cd`, `pushd`, `popd`: moving the tracked working directory. */

import { resolve as resolveAgainst } from "../../shared/posix-path.ts";
import type { Builtin, BuiltinInput } from "./types.ts";

/**
 * Moves to `target`, or makes the cwd unknown when the target is not a plain
 * known path (a glob, or a value we could not compute).
 */
function setDirectory(
    input: BuiltinInput,
    value: string | undefined,
    glob: boolean,
): void {
    const { scope } = input;
    if (value === undefined || glob) {
        scope.env.cwd = undefined;
        return;
    }
    const resolved = resolveAgainst(scope.env.cwd, value);
    if (resolved === undefined) {
        scope.env.cwd = undefined;
        return;
    }
    scope.env.oldPwd = scope.env.cwd;
    scope.env.cwd = resolved;
}

export class CdBuiltin implements Builtin {
    readonly names = ["cd"] as const;

    apply(input: BuiltinInput): void {
        const rest = input.argv.slice(1);
        let index = 0;
        for (; index < rest.length; index += 1) {
            const value = rest[index]?.value;
            if (value === "--") {
                index += 1;
                break;
            }
            if (value !== undefined && /^-[LPe@-]+$/.test(value)) {
                continue;
            }
            break;
        }
        const targets = rest.slice(index);
        if (targets.length > 1) {
            input.scope.env.cwd = undefined;
            return;
        }
        if (targets.length === 0) {
            const home = input.store.lookupString(input.scope, "HOME");
            setDirectory(input, home, false);
            return;
        }
        const target = targets[0];
        if (target?.value === "-") {
            const previous = input.scope.env.oldPwd;
            input.scope.env.oldPwd = input.scope.env.cwd;
            input.scope.env.cwd = previous;
            return;
        }
        setDirectory(input, target?.value, target?.glob ?? false);
    }
}

export class PushdBuiltin implements Builtin {
    readonly names = ["pushd"] as const;

    apply(input: BuiltinInput): void {
        const rest = input.argv.slice(1).filter((arg) => arg.value !== "-n");
        const target = rest[0];
        if (target === undefined) {
            const top = input.scope.env.dirStack.pop();
            if (top === undefined) {
                return;
            }
            const cwd = input.scope.env.cwd;
            input.scope.env.cwd = top === "" ? undefined : top;
            input.scope.env.dirStack.push(cwd ?? "");
            return;
        }
        input.scope.env.dirStack.push(input.scope.env.cwd ?? "");
        setDirectory(input, target?.value, target?.glob ?? false);
    }
}

export class PopdBuiltin implements Builtin {
    readonly names = ["popd"] as const;

    apply(input: BuiltinInput): void {
        const dir = input.scope.env.dirStack.pop();
        if (dir === undefined) {
            return;
        }
        input.scope.env.oldPwd = input.scope.env.cwd;
        input.scope.env.cwd = dir === "" ? undefined : dir;
    }
}
