// SSH has a large, irregular option grammar.
/* eslint-disable sonarjs/cognitive-complexity, sonarjs/function-return-type */
/**
 * `ssh`: the first non-option word is `[user@]host`; the remaining words are
 * joined with spaces and run on the remote host, whose working directory and
 * environment are unknown. Without a command, a stdin heredoc becomes the
 * remote script (`ssh host bash -s <<EOF`).
 */

import { Environment, type Scope } from "../environment.ts";
import { isOption, matchesProgram, scriptResult } from "./options.ts";
import { splitLong } from "./scan.ts";
import type { UnwrapInput, Unwrapped, Wrapper } from "./types.ts";

const SSH_VALUE_SHORT: ReadonlySet<string> = new Set("bcDEeFIiJLlmOopQRSWw".split(""));
const SSH_FLAG_SHORT: ReadonlySet<string> = new Set(
    "1246AaCfGgKkMNnqsTtVvXxYy".split(""),
);

export class SshWrapper implements Wrapper {
    readonly name = "ssh";

    unwrap(input: UnwrapInput): Unwrapped | undefined {
        if (matchesProgram(input, ["ssh"]) === undefined) {
            return undefined;
        }
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
                if (flag === "--" || flag === "--version" || flag === "--help") {
                    if (flag === "--version" || flag === "--help") {
                        return undefined;
                    }
                    continue;
                }
                // Long options mirror the short ones; consume an inline value.
                if (flag === "--config" || flag === "--option" || flag === "--port") {
                    if (inline === undefined) {
                        index += 1;
                    }
                    continue;
                }
                return undefined;
            }
            for (let c = 1; c < value.length; c += 1) {
                const ch = value[c] as string;
                if (SSH_FLAG_SHORT.has(ch)) {
                    continue;
                }
                if (SSH_VALUE_SHORT.has(ch)) {
                    if (value.slice(c + 1) === "") {
                        index += 1;
                    }
                    break;
                }
                return undefined;
            }
        }
        const hostArg = input.argv[index];
        const host = hostArg?.value;
        if (host === undefined) {
            return undefined;
        }
        const remoteScope: Scope = {
            host: { kind: "remote", via: "ssh", target: host },
            env: Environment.empty(false),
        };
        const remaining = input.argv.slice(index + 1);
        const stdin = input.stdin.shellStdin();
        if (remaining.length > 0) {
            return scriptResult(
                { kind: "joined", args: remaining },
                remoteScope,
                "external",
                stdin?.text,
            );
        }
        if (stdin !== undefined) {
            return scriptResult(
                {
                    kind: "heredoc",
                    text: stdin.text,
                    span: stdin.span,
                    redirect: stdin.redirect,
                },
                remoteScope,
                "external",
            );
        }
        return undefined;
    }
}
