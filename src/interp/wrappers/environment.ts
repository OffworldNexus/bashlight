// Option scanning is branchy by nature.
/* eslint-disable sonarjs/cognitive-complexity, sonarjs/function-return-type */
/**
 * Wrappers that change the environment the inner command sees: `env` (with
 * `-i`/`-u`/`NAME=value`/`-C`) and `sudo`/`doas` (with `-E` and a handful of
 * options). Without `-E`, `sudo` hides the parent environment.
 */

import { resolve as resolveAgainst } from "../../shared/posix-path.ts";
import { Environment, type Scope } from "../environment.ts";
import type { Arg } from "../values.ts";
import {
    assignmentParts,
    commandResult,
    isAssignmentArg,
    isOption,
    matchesProgram,
} from "./options.ts";
import { splitLong } from "./scan.ts";
import type { UnwrapInput, Unwrapped, Wrapper } from "./types.ts";

function setEnvAssignment(scope: Scope, arg: Arg): void {
    const parts = assignmentParts(arg.value ?? "");
    if (parts === undefined) {
        return;
    }
    scope.env.put(parts.name, {
        state:
            arg.value === undefined
                ? { kind: "unknown" }
                : { kind: "set", value: parts.value },
        binding: undefined,
        exported: true,
    });
}

export class EnvWrapper implements Wrapper {
    readonly name = "env";

    unwrap(input: UnwrapInput): Unwrapped | undefined {
        if (matchesProgram(input, ["env"]) === undefined) {
            return undefined;
        }
        const unset: string[] = [];
        const assignments: Arg[] = [];
        let ignore = false;
        let chdir: string | undefined;
        let index = 1;
        for (; index < input.argv.length; index += 1) {
            const arg = input.argv[index];
            const value = arg?.value;
            if (value === undefined) {
                return undefined;
            }
            if (value === "--") {
                index += 1;
                break;
            }
            if (isAssignmentArg(value)) {
                assignments.push(arg as Arg);
                continue;
            }
            if (!isOption(value)) {
                break;
            }
            if (value.startsWith("--")) {
                const [flag, inline] = splitLong(value);
                if (flag === "--ignore-environment") {
                    ignore = true;
                } else if (flag === "--unset") {
                    const name = inline ?? input.argv[index + 1]?.value;
                    if (name === undefined) {
                        return undefined;
                    }
                    unset.push(name);
                    if (inline === undefined) {
                        index += 1;
                    }
                } else if (flag === "--chdir") {
                    const dir = inline ?? input.argv[index + 1]?.value;
                    if (dir === undefined) {
                        return undefined;
                    }
                    chdir = dir;
                    if (inline === undefined) {
                        index += 1;
                    }
                } else if (flag === "--null") {
                    // accepted, no effect
                } else {
                    return undefined;
                }
                continue;
            }
            for (let c = 1; c < value.length; c += 1) {
                const ch = value[c];
                if (ch === "i") {
                    ignore = true;
                } else if (ch === "0") {
                    // accepted
                } else if (ch === "u" || ch === "C") {
                    const rest = value.slice(c + 1);
                    const operand = rest !== "" ? rest : input.argv[index + 1]?.value;
                    if (operand === undefined) {
                        return undefined;
                    }
                    if (ch === "u") {
                        unset.push(operand);
                    } else {
                        chdir = operand;
                    }
                    if (rest === "") {
                        index += 1;
                    }
                    break;
                } else {
                    return undefined;
                }
            }
        }
        if (index >= input.argv.length) {
            return undefined;
        }
        const base = ignore ? Environment.empty(true) : input.scope.env.fork();
        for (const name of unset) {
            base.remove(name);
        }
        const scope: Scope = { host: input.scope.host, env: base };
        for (const arg of assignments) {
            setEnvAssignment(scope, arg);
        }
        if (chdir !== undefined) {
            base.cwd = resolveAgainst(base.cwd, chdir);
        }
        return commandResult(index, scope);
    }
}

const SUDO_VALUE_SHORT: ReadonlySet<string> = new Set([
    "u",
    "g",
    "p",
    "C",
    "D",
    "T",
    "U",
    "R",
]);
const SUDO_VALUE_LONG: ReadonlySet<string> = new Set([
    "--user",
    "--group",
    "--prompt",
    "--close-from",
    "--chdir",
    "--command-timeout",
    "--host",
    "--other-user",
]);

export class SudoWrapper implements Wrapper {
    readonly name = "sudo";

    unwrap(input: UnwrapInput): Unwrapped | undefined {
        if (matchesProgram(input, ["sudo", "doas"]) === undefined) {
            return undefined;
        }
        let preserve = false;
        let index = 1;
        for (; index < input.argv.length; index += 1) {
            const value = input.argv[index]?.value;
            if (value === undefined) {
                return undefined;
            }
            if (value === "--") {
                index += 1;
                break;
            }
            if (!isOption(value)) {
                break;
            }
            if (value.startsWith("--")) {
                const [flag, inline] = splitLong(value);
                if (flag === "--preserve-env") {
                    preserve = true;
                } else if (
                    flag === "--login" ||
                    flag === "--shell" ||
                    flag === "--set-home" ||
                    flag === "--non-interactive" ||
                    flag === "--stdin" ||
                    flag === "--reset-timestamp" ||
                    flag === "--validate" ||
                    flag === "--remove-timestamp"
                ) {
                    // accepted, no effect
                } else if (SUDO_VALUE_LONG.has(flag)) {
                    if (inline === undefined) {
                        index += 1;
                    }
                } else {
                    return undefined;
                }
                continue;
            }
            for (let c = 1; c < value.length; c += 1) {
                const ch = value[c] as string;
                if (SUDO_VALUE_SHORT.has(ch)) {
                    if (value.slice(c + 1) === "") {
                        index += 1;
                    }
                    break;
                }
                if (ch === "E") {
                    preserve = true;
                } else if (
                    ch === "H" ||
                    ch === "n" ||
                    ch === "S" ||
                    ch === "b" ||
                    ch === "i" ||
                    ch === "s" ||
                    ch === "A" ||
                    ch === "k" ||
                    ch === "K"
                ) {
                    // accepted, no effect
                } else {
                    return undefined;
                }
            }
        }
        if (index >= input.argv.length) {
            return undefined;
        }
        const env = preserve ? input.scope.env.fork() : Environment.empty(false);
        return commandResult(index, { host: input.scope.host, env });
    }
}
