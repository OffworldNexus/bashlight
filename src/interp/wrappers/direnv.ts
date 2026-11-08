/* eslint-disable sonarjs/function-return-type */
/** `direnv exec DIR cmd` runs `cmd` with the cwd set to `DIR`. */

import { commandResult, matchesProgram, resolveDirectory } from "./options.ts";
import type { UnwrapInput, Unwrapped, Wrapper } from "./types.ts";

export class DirenvWrapper implements Wrapper {
    readonly name = "direnv";

    unwrap(input: UnwrapInput): Unwrapped | undefined {
        if (matchesProgram(input, ["direnv"]) === undefined) {
            return undefined;
        }
        if (input.argv[1]?.value !== "exec") {
            return undefined;
        }
        const dir = input.argv[2]?.value;
        if (dir === undefined) {
            return undefined;
        }
        let index = 3;
        if (input.argv[index]?.value === "--") {
            index += 1;
        }
        if (index >= input.argv.length) {
            return undefined;
        }
        const env = input.scope.env.fork();
        env.cwd = resolveDirectory(input.scope, dir);
        return commandResult(index, { host: input.scope.host, env });
    }
}
