// One table for the pass-through wrappers.
/* eslint-disable sonarjs/cognitive-complexity, sonarjs/function-return-type */
/**
 * `PrefixWrapper`: the pass-through wrappers that run their argv suffix as the
 * effective command (`timeout`, `nice`, `nohup`, `stdbuf`, `ionice`, `chrt`,
 * `/usr/bin/time`, `exec`, `command`, `builtin`). One table row per program.
 *
 * `flock` (whose `-c` form runs a script) and `eval` keep their own classes.
 */

import type { Scope } from "../environment.ts";
import type { Arg } from "../values.ts";
import { commandResult, isOption, matchesProgram, scriptResult } from "./options.ts";
import { type OptionSpec, scanOptions, splitLong } from "./scan.ts";
import type { UnwrapInput, Unwrapped, Wrapper } from "./types.ts";

const DIGITS: ReadonlySet<string> = new Set("0123456789".split(""));

const spec = (partial: Partial<OptionSpec>): OptionSpec => ({
    shortFlags: partial.shortFlags ?? new Set(),
    shortValues: partial.shortValues ?? new Set(),
    longFlags: partial.longFlags ?? new Set(),
    longValues: partial.longValues ?? new Set(),
});

interface PrefixSpec {
    readonly name: string;
    readonly programs: readonly string[];
    readonly options: OptionSpec;
    /** Non-option words to skip before the effective command. */
    readonly positionals: number;
    readonly execStyle: boolean;
    /** Extra rejection (e.g. `command -v` is a query, not a run). */
    readonly reject?: (input: UnwrapInput) => boolean;
}

const TIMEOUT: PrefixSpec = {
    name: "timeout",
    programs: ["timeout"],
    options: spec({
        shortFlags: new Set(["v"]),
        shortValues: new Set(["s", "k"]),
        longFlags: new Set(["--preserve-status", "--foreground", "--verbose"]),
        longValues: new Set(["--signal", "--kill-after"]),
    }),
    positionals: 1,
    execStyle: true,
};

const NICE: PrefixSpec = {
    name: "nice",
    programs: ["nice"],
    options: spec({
        shortFlags: DIGITS,
        shortValues: new Set(["n"]),
        longValues: new Set(["--adjustment"]),
    }),
    positionals: 0,
    execStyle: true,
};

const NOHUP: PrefixSpec = {
    name: "nohup",
    programs: ["nohup"],
    options: spec({}),
    positionals: 0,
    execStyle: true,
};

const STDBUF: PrefixSpec = {
    name: "stdbuf",
    programs: ["stdbuf"],
    options: spec({
        shortValues: new Set(["i", "o", "e"]),
        longValues: new Set(["--input", "--output", "--error"]),
    }),
    positionals: 0,
    execStyle: true,
};

const IONICE: PrefixSpec = {
    name: "ionice",
    programs: ["ionice"],
    options: spec({
        shortFlags: new Set(["t", "u"]),
        shortValues: new Set(["c", "n"]),
        longFlags: new Set(["--ignore"]),
        longValues: new Set(["--class", "--classdata"]),
    }),
    positionals: 0,
    execStyle: true,
    reject: (input) => hasPidOption(input.argv),
};

const CHRT: PrefixSpec = {
    name: "chrt",
    programs: ["chrt"],
    options: spec({
        shortFlags: new Set(["f", "b", "o", "r", "d", "a", "i", "m", "R", "v"]),
    }),
    positionals: 1,
    execStyle: true,
    reject: (input) => hasPidOption(input.argv),
};

const TIME: PrefixSpec = {
    name: "time",
    programs: ["time"],
    options: spec({
        shortFlags: new Set(["v", "p", "a", "q", "h", "V"]),
        shortValues: new Set(["f", "o"]),
        longFlags: new Set(["--verbose", "--portability", "--append", "--quiet"]),
        longValues: new Set(["--format", "--output"]),
    }),
    positionals: 0,
    execStyle: true,
};

const EXEC: PrefixSpec = {
    name: "exec",
    programs: ["exec"],
    options: spec({ shortFlags: new Set(["c", "l"]), shortValues: new Set(["a"]) }),
    positionals: 0,
    execStyle: false,
};

const COMMAND: PrefixSpec = {
    name: "command",
    programs: ["command"],
    options: spec({ shortFlags: new Set(["p"]) }),
    positionals: 0,
    execStyle: false,
    reject: (input) => {
        const next = input.argv[1]?.value;
        return next === "-v" || next === "-V";
    },
};

const BUILTIN: PrefixSpec = {
    name: "builtin",
    programs: ["builtin"],
    options: spec({}),
    positionals: 0,
    execStyle: false,
};

const PREFIX_SPECS: readonly PrefixSpec[] = [
    TIMEOUT,
    NICE,
    NOHUP,
    STDBUF,
    IONICE,
    CHRT,
    TIME,
    EXEC,
    COMMAND,
    BUILTIN,
];

export class PrefixWrapper implements Wrapper {
    readonly name: string;
    readonly execStyle: boolean;

    constructor(private readonly prefix: PrefixSpec) {
        this.name = prefix.name;
        this.execStyle = prefix.execStyle;
    }

    unwrap(input: UnwrapInput): Unwrapped | undefined {
        if (matchesProgram(input, this.prefix.programs) === undefined) {
            return undefined;
        }
        if (this.prefix.reject?.(input) === true) {
            return undefined;
        }
        const index = scanOptions(input.argv, 1, this.prefix.options);
        if (index === undefined) {
            return undefined;
        }
        const commandAt = index + this.prefix.positionals;
        if (commandAt >= input.argv.length) {
            return undefined;
        }
        return commandResult(commandAt, input.scope);
    }
}

/** `eval 'cmd …'`: the arguments are joined and run in the current shell. */
export class EvalWrapper implements Wrapper {
    readonly name = "eval";

    unwrap(input: UnwrapInput): Unwrapped | undefined {
        if (matchesProgram(input, ["eval"]) === undefined) {
            return undefined;
        }
        const args = input.argv.slice(1);
        if (args.length === 0) {
            return undefined;
        }
        return scriptResult({ kind: "joined", args }, input.scope, "builtin");
    }
}

/** `flock`: `-c cmd` runs a script, otherwise `FILE cmd` runs argv. */
export class FlockWrapper implements Wrapper {
    readonly name = "flock";
    readonly execStyle = true;

    unwrap(input: UnwrapInput): Unwrapped | undefined {
        if (matchesProgram(input, ["flock"]) === undefined) {
            return undefined;
        }
        let index = 1;
        let commandViaShell: Arg | undefined;
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
                if (
                    flag === "--exclusive" ||
                    flag === "--shared" ||
                    flag === "--nonblock" ||
                    flag === "--close" ||
                    flag === "--no-fork"
                ) {
                    continue;
                }
                if (
                    flag === "--wait" ||
                    flag === "--conflict-exit-code" ||
                    flag === "--command"
                ) {
                    if (inline !== undefined) {
                        return undefined;
                    }
                    const operandArg = input.argv[index + 1];
                    if (operandArg === undefined) {
                        return undefined;
                    }
                    if (flag === "--command") {
                        commandViaShell = operandArg;
                    }
                    index += 1;
                    continue;
                }
                return undefined;
            }
            for (let c = 1; c < value.length; c += 1) {
                const ch = value[c] as string;
                if (
                    ch === "x" ||
                    ch === "s" ||
                    ch === "n" ||
                    ch === "o" ||
                    ch === "F"
                ) {
                    continue;
                }
                if (ch === "w" || ch === "E" || ch === "c") {
                    const rest = value.slice(c + 1);
                    const arg = rest !== "" ? input.argv[index] : input.argv[index + 1];
                    if (arg === undefined) {
                        return undefined;
                    }
                    if (ch === "c") {
                        commandViaShell = arg;
                    }
                    if (rest === "") {
                        index += 1;
                    }
                    break;
                }
                return undefined;
            }
        }
        if (commandViaShell !== undefined) {
            return scriptResult(
                { kind: "arg", arg: commandViaShell },
                childScopeOf(input.scope),
                "external",
            );
        }
        if (index >= input.argv.length) {
            return undefined;
        }
        const commandAt = index + 1;
        if (commandAt >= input.argv.length) {
            return undefined;
        }
        return commandResult(commandAt, input.scope);
    }
}

function childScopeOf(scope: Scope): Scope {
    return { host: scope.host, env: scope.env.exportedFork() };
}

export function createPrefixWrappers(): readonly Wrapper[] {
    return PREFIX_SPECS.map((prefix) => new PrefixWrapper(prefix));
}

function hasPidOption(argv: readonly Arg[]): boolean {
    for (const arg of argv) {
        const value = arg.value;
        if (value === undefined || value === "--") {
            return false;
        }
        if (!isOption(value)) {
            return false;
        }
        if (value === "-p" || /^-p\d/.test(value)) {
            return true;
        }
        if (value.startsWith("--")) {
            const [flag] = splitLong(value);
            if (flag === "--pid") {
                return true;
            }
        }
    }
    return false;
}
