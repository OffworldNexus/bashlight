// Option scanning is branchy by nature.
/* eslint-disable sonarjs/cognitive-complexity, sonarjs/function-return-type */
/**
 * The shell wrappers: `bash`/`sh`/`zsh`/`dash`/`ksh`/`ash`. With `-c STRING`
 * they run a script string; with no command (or `-s`) they read their script
 * from stdin (a heredoc/herestring). Either way the nested script runs in a
 * child shell: same host/cwd, only the exported variables are visible.
 */

import { stringValues } from "../documents.ts";
import type { Scope } from "../environment.ts";
import { childScope } from "../environment.ts";
import { isOption, matchesProgram, scriptResult } from "./options.ts";
import { splitLong } from "./scan.ts";
import type { UnwrapInput, Unwrapped, Wrapper } from "./types.ts";

const SHELLS: readonly string[] = ["bash", "sh", "zsh", "dash", "ksh", "ash"];

const SHELL_FLAGS: ReadonlySet<string> = new Set("exunvfmbathBECTkprdil".split(""));

export class ShellWrapper implements Wrapper {
    readonly name = "shell";

    unwrap(input: UnwrapInput): Unwrapped | undefined {
        if (matchesProgram(input, SHELLS) === undefined) {
            return undefined;
        }
        let hasCommand = false;
        let wantStdin = false;
        let index = 1;
        for (; index < input.argv.length; index += 1) {
            const value = input.argv[index]?.value;
            if (value === undefined) {
                return undefined;
            }
            if (value === "--") {
                index += 1;
                wantStdin = true;
                break;
            }
            if (!isOption(value)) {
                break;
            }
            if (value.startsWith("--")) {
                const [flag, inline] = splitLong(value);
                if (
                    flag === "--login" ||
                    flag === "--norc" ||
                    flag === "--noprofile" ||
                    flag === "--posix" ||
                    flag === "--restricted" ||
                    flag === "--verbose" ||
                    flag === "--noediting" ||
                    flag === "--debugger"
                ) {
                    continue;
                }
                if (flag === "--rcfile" || flag === "--init-file") {
                    if (inline === undefined) {
                        index += 1;
                    }
                    continue;
                }
                return undefined;
            }
            for (let c = 1; c < value.length; c += 1) {
                const ch = value[c] as string;
                if (ch === "c") {
                    hasCommand = true;
                    break;
                }
                if (ch === "s") {
                    wantStdin = true;
                    continue;
                }
                if (ch === "o" || ch === "O") {
                    if (value.slice(c + 1) === "") {
                        index += 1;
                    }
                    break;
                }
                if (SHELL_FLAGS.has(ch)) {
                    continue;
                }
                return undefined;
            }
            if (hasCommand) {
                break;
            }
        }
        if (hasCommand) {
            const script = input.argv[index + 1];
            if (script === undefined) {
                return undefined;
            }
            const nameArg = input.argv[index + 2];
            const positionals = input.argv.slice(index + 3);
            const scope = childShell(input.scope, nameArg?.value, positionals);
            return scriptResult({ kind: "arg", arg: script }, scope, "external");
        }
        if (!wantStdin && index < input.argv.length) {
            // A script file name we cannot read (no I/O).
            return undefined;
        }
        const stdin = input.stdin.shellStdin();
        if (stdin === undefined) {
            return undefined;
        }
        return scriptResult(
            {
                kind: "heredoc",
                text: stdin.text,
                span: stdin.span,
                redirect: stdin.redirect,
            },
            childShell(input.scope, undefined, []),
            "external",
        );
    }
}

function childShell(
    scope: Scope,
    shellName: string | undefined,
    positionals: readonly import("../values.ts").Arg[],
): Scope {
    const child = childScope(scope);
    if (shellName !== undefined) {
        child.env.shellName = shellName;
    }
    child.env.positionals = stringValues(positionals);
    return child;
}
