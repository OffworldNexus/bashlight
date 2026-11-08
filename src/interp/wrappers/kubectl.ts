/* eslint-disable sonarjs/function-return-type */
/** `kubectl exec` runs its argv after a `--` on a remote pod. */

import { Environment, type Scope } from "../environment.ts";
import { commandResult, matchesProgram } from "./options.ts";
import { type OptionSpec, scanOptions } from "./scan.ts";
import type { UnwrapInput, Unwrapped, Wrapper } from "./types.ts";

const KUBECTL_OPTIONS: OptionSpec = {
    shortFlags: new Set(["i", "t"]),
    shortValues: new Set(["n", "c"]),
    longFlags: new Set(["--stdin", "--tty", "--interactive"]),
    longValues: new Set(["--namespace", "--container"]),
};

export class KubectlWrapper implements Wrapper {
    readonly name = "kubectl";

    unwrap(input: UnwrapInput): Unwrapped | undefined {
        if (matchesProgram(input, ["kubectl"]) === undefined) {
            return undefined;
        }
        if (input.argv[1]?.value !== "exec") {
            return undefined;
        }
        const index = scanOptions(input.argv, 2, KUBECTL_OPTIONS);
        if (index === undefined) {
            return undefined;
        }
        const pod = input.argv[index]?.value;
        if (pod === undefined) {
            return undefined;
        }
        const separator = input.argv[index + 1]?.value;
        if (separator !== "--") {
            return undefined;
        }
        const commandAt = index + 2;
        if (commandAt >= input.argv.length) {
            return undefined;
        }
        const scope: Scope = {
            host: { kind: "remote", via: "kubectl", target: pod },
            env: Environment.empty(false),
        };
        return commandResult(commandAt, scope);
    }
}
