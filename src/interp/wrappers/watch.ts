/* eslint-disable sonarjs/function-return-type */
/** `watch` runs its arguments through `sh -c`, several times. */

import type { Scope } from "../environment.ts";
import { childScope } from "../environment.ts";
import { matchesProgram, scriptResult } from "./options.ts";
import { type OptionSpec, scanOptions } from "./scan.ts";
import type { UnwrapInput, Unwrapped, Wrapper } from "./types.ts";

const WATCH_OPTIONS: OptionSpec = {
    shortFlags: new Set(["d", "t", "x", "g", "b", "e", "c", "p"]),
    shortValues: new Set(["n"]),
    longFlags: new Set([
        "--differences",
        "--no-title",
        "--exec",
        "--chgexit",
        "--beep",
        "--errexit",
        "--color",
        "--precise",
    ]),
    longValues: new Set(["--interval"]),
};

export class WatchWrapper implements Wrapper {
    readonly name = "watch";

    unwrap(input: UnwrapInput): Unwrapped | undefined {
        if (matchesProgram(input, ["watch"]) === undefined) {
            return undefined;
        }
        const index = scanOptions(input.argv, 1, WATCH_OPTIONS);
        if (index === undefined || index >= input.argv.length) {
            return undefined;
        }
        const args = input.argv.slice(index);
        if (args.length === 0 || args.some((arg) => arg.value === undefined)) {
            return undefined;
        }
        const scope: Scope = childScope(input.scope);
        return scriptResult({ kind: "joined", args }, scope, "external");
    }
}
