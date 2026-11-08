/** `unset`, `set --`, `shift`, and the pass-through builtins. */

import { stringValues } from "../documents.ts";
import type { Builtin, BuiltinInput } from "./types.ts";

export class UnsetBuiltin implements Builtin {
    readonly names = ["unset"] as const;

    apply(input: BuiltinInput): void {
        const args = input.argv.slice(1);
        let functionOnly = false;
        let variableOnly = false;
        const names: string[] = [];
        for (const arg of args) {
            const value = arg.value;
            if (value === undefined) {
                continue;
            }
            if (value === "-f") {
                functionOnly = true;
                continue;
            }
            if (value === "-v") {
                variableOnly = true;
                continue;
            }
            if (value === "--") {
                continue;
            }
            names.push(value);
        }
        for (const name of names) {
            if (functionOnly && !variableOnly) {
                input.store.removeFunction(input.scope, name);
            } else {
                input.store.removeVariable(input.scope, name);
            }
        }
    }
}

export class SetBuiltin implements Builtin {
    readonly names = ["set"] as const;

    apply(input: BuiltinInput): void {
        const rest = input.argv.slice(1);
        const separator = rest.findIndex((arg) => arg.value === "--");
        if (separator === -1) {
            return;
        }
        input.scope.env.positionals = stringValues(rest.slice(separator + 1));
    }
}

export class ShiftBuiltin implements Builtin {
    readonly names = ["shift"] as const;

    apply(input: BuiltinInput): void {
        const positionals = input.scope.env.positionals;
        if (positionals === undefined) {
            return;
        }
        const countText = input.argv[1]?.value ?? "1";
        if (!/^\d+$/.test(countText)) {
            input.scope.env.positionals = undefined;
            return;
        }
        input.scope.env.positionals = positionals.slice(Number.parseInt(countText, 10));
    }
}

const PASSTHROUGH = [
    "echo",
    "test",
    "[",
    "[[",
    "true",
    "false",
    ":",
    "pwd",
    "exit",
    "return",
    "break",
    "continue",
    "wait",
    "trap",
    "type",
    "hash",
    "alias",
    "shopt",
    "umask",
    "ulimit",
    "jobs",
    "kill",
    "let",
    "eval",
    "exec",
    "command",
    "builtin",
    "times",
    "suspend",
    "logout",
    "disown",
    "enable",
    "help",
    "history",
    "dirs",
    "caller",
];

/** Builtins with no static effect we model: reported as `kind: "builtin"`. */
export class PassthroughBuiltin implements Builtin {
    readonly names = PASSTHROUGH;

    apply(): void {
        // Nothing to model.
    }
}
