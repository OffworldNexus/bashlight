// Option scanning is branchy by nature.
/* eslint-disable sonarjs/cognitive-complexity, sonarjs/function-return-type */
/**
 * `xargs` (the command it runs is the remaining words) and `find … -exec cmd …
 * ;|+` (each `-exec` run is a separate effective command).
 */

import { commandResult, matchesProgram } from "./options.ts";
import { type OptionSpec, scanOptions } from "./scan.ts";
import type { EffectiveCommand } from "./types.ts";
import type { UnwrapInput, Unwrapped, Wrapper } from "./types.ts";

const XARGS_OPTIONS: OptionSpec = {
    shortFlags: new Set(["0", "r", "t", "p", "x"]),
    shortValues: new Set(["n", "L", "I", "P", "d", "s", "a", "E"]),
    longFlags: new Set([
        "--null",
        "--no-run-if-empty",
        "--verbose",
        "--interactive",
        "--exit",
        "--show-limits",
    ]),
    longValues: new Set([
        "--max-args",
        "--max-lines",
        "--replace",
        "--max-procs",
        "--delimiter",
        "--max-chars",
        "--arg-file",
        "--eof",
        "--process-slot-var",
    ]),
};

export class XargsWrapper implements Wrapper {
    readonly name = "xargs";
    readonly execStyle = true;

    unwrap(input: UnwrapInput): Unwrapped | undefined {
        if (matchesProgram(input, ["xargs"]) === undefined) {
            return undefined;
        }
        const index = scanOptions(input.argv, 1, XARGS_OPTIONS);
        if (index === undefined || index >= input.argv.length) {
            return undefined;
        }
        return commandResult(index, input.scope);
    }
}

const FIND_EXEC = new Set(["-exec", "-execdir", "-ok", "-okdir"]);

export class FindWrapper implements Wrapper {
    readonly name = "find";
    readonly execStyle = true;

    unwrap(input: UnwrapInput): Unwrapped | readonly Unwrapped[] | undefined {
        if (matchesProgram(input, ["find"]) === undefined) {
            return undefined;
        }
        const commands: EffectiveCommand[] = [];
        let index = 1;
        while (index < input.argv.length) {
            const value = input.argv[index]?.value;
            if (value !== undefined && FIND_EXEC.has(value)) {
                let end = -1;
                for (let j = index + 1; j < input.argv.length; j += 1) {
                    const terminator = input.argv[j]?.value;
                    if (terminator === ";" || terminator === "+") {
                        end = j;
                        break;
                    }
                }
                if (end === -1) {
                    return commands.length > 0 ? commands : undefined;
                }
                if (end - (index + 1) >= 1) {
                    commands.push({
                        kind: "command",
                        offset: index + 1,
                        end,
                        scope: input.scope,
                    });
                }
                index = end;
            }
            index += 1;
        }
        return commands.length > 0 ? commands : undefined;
    }
}
