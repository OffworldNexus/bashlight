// Container wrappers have many irregular options.
/* eslint-disable sonarjs/cognitive-complexity, sonarjs/function-return-type */
/**
 * `docker`/`podman` (`exec`, `run`, `compose exec|run`), legacy
 * `docker-compose`, all of which run a command on a remote host (a container).
 * The remote cwd comes from `-w`/`--workdir`, the known environment from
 * `-e`/`--env` assignments; everything else is unknown.
 */

import { Environment, type Scope } from "../environment.ts";
import { commandResult, isOption, matchesProgram } from "./options.ts";
import { splitLong } from "./scan.ts";
import type { UnwrapInput, Unwrapped, Wrapper } from "./types.ts";

type Category = "flag" | "value" | "env" | "workdir" | "entrypoint";

interface OptionMap {
    readonly short: ReadonlyMap<string, Category>;
    readonly long: ReadonlyMap<string, Category>;
}

interface ScanResult {
    readonly index: number;
    readonly env: readonly {
        readonly name: string;
        readonly value: string | undefined;
    }[];
    readonly workdir: string | undefined;
}

function map(
    short: readonly (readonly [string, Category])[],
    long: readonly (readonly [string, Category])[],
): OptionMap {
    return { short: new Map(short), long: new Map(long) };
}

function scanContainer(
    argv: readonly { readonly value: string | undefined }[],
    start: number,
    options: OptionMap,
): ScanResult | undefined {
    let index = start;
    const env: { name: string; value: string | undefined }[] = [];
    let workdir: string | undefined;
    const record = (category: Category, operand: string): void => {
        if (category === "env") {
            const eq = operand.indexOf("=");
            env.push(
                eq <= 0
                    ? { name: operand, value: undefined }
                    : { name: operand.slice(0, eq), value: operand.slice(eq + 1) },
            );
        } else if (category === "workdir") {
            workdir = operand;
        }
    };
    while (index < argv.length) {
        const value = argv[index]?.value;
        if (value === undefined) {
            return undefined;
        }
        if (value === "--") {
            return { index: index + 1, env, workdir };
        }
        if (!isOption(value)) {
            return { index, env, workdir };
        }
        if (value.startsWith("--")) {
            const [flag, inline] = splitLong(value);
            const category = options.long.get(flag);
            if (category === undefined || category === "entrypoint") {
                return undefined;
            }
            if (category === "flag") {
                index += 1;
                continue;
            }
            const operand = inline ?? argv[index + 1]?.value;
            if (operand === undefined) {
                return undefined;
            }
            record(category, operand);
            index += inline === undefined ? 2 : 1;
            continue;
        }
        let advanced = false;
        for (let c = 1; c < value.length; c += 1) {
            const category = options.short.get(value[c] as string);
            if (category === undefined) {
                return undefined;
            }
            if (category === "flag") {
                continue;
            }
            const rest = value.slice(c + 1);
            const operand = rest !== "" ? rest : argv[index + 1]?.value;
            if (operand === undefined) {
                return undefined;
            }
            record(category, operand);
            advanced = rest === "";
            break;
        }
        index += advanced ? 2 : 1;
    }
    return { index, env, workdir };
}

function remoteScope(via: string, target: string | undefined, scan: ScanResult): Scope {
    const env = Environment.empty(false);
    env.cwd =
        scan.workdir !== undefined && scan.workdir.startsWith("/")
            ? scan.workdir
            : undefined;
    for (const { name, value } of scan.env) {
        env.put(name, {
            state: value === undefined ? { kind: "unknown" } : { kind: "set", value },
            binding: undefined,
            exported: true,
        });
    }
    return { host: { kind: "remote", via, target }, env };
}

const COMMON_RUN: readonly (readonly [string, Category])[] = [
    ["i", "flag"],
    ["t", "flag"],
    ["d", "flag"],
    ["e", "env"],
    ["w", "workdir"],
    ["u", "value"],
];

const EXEC_MAP = map(
    [
        ["i", "flag"],
        ["t", "flag"],
        ["d", "flag"],
        ["u", "value"],
        ["w", "workdir"],
        ["e", "env"],
    ],
    [
        ["--interactive", "flag"],
        ["--tty", "flag"],
        ["--detach", "flag"],
        ["--privileged", "flag"],
        ["--user", "value"],
        ["--workdir", "workdir"],
        ["--env", "env"],
        ["--env-file", "value"],
    ],
);

const RUN_MAP = map(
    [...COMMON_RUN, ["v", "value"], ["p", "value"], ["m", "value"], ["n", "value"]],
    [
        ["--rm", "flag"],
        ["--interactive", "flag"],
        ["--tty", "flag"],
        ["--detach", "flag"],
        ["--name", "value"],
        ["--volume", "value"],
        ["--env", "env"],
        ["--workdir", "workdir"],
        ["--network", "value"],
        ["--publish", "value"],
        ["--user", "value"],
        ["--memory", "value"],
        ["--entrypoint", "entrypoint"],
    ],
);

const COMPOSE_MAP = map(
    [
        ["T", "flag"],
        ["d", "flag"],
        ["u", "value"],
        ["w", "workdir"],
        ["e", "env"],
    ],
    [
        ["--rm", "flag"],
        ["--no-deps", "flag"],
        ["--service-ports", "flag"],
        ["--detach", "flag"],
        ["--user", "value"],
        ["--workdir", "workdir"],
        ["--env", "env"],
        ["--entrypoint", "entrypoint"],
    ],
);

export class DockerWrapper implements Wrapper {
    readonly name = "docker";

    unwrap(input: UnwrapInput): Unwrapped | undefined {
        const program = matchesProgram(input, [
            "docker",
            "podman",
            "docker-compose",
            "podman-compose",
        ]);
        if (program === undefined) {
            return undefined;
        }
        const sub = input.argv[1]?.value;
        if (program === "docker" || program === "podman") {
            if (sub === "exec") {
                return containerCommand(input, 2, EXEC_MAP, program);
            }
            if (sub === "run") {
                return containerCommand(input, 2, RUN_MAP, program);
            }
            if (sub === "compose") {
                const composeSub = input.argv[2]?.value;
                if (composeSub === "exec" || composeSub === "run") {
                    return containerCommand(input, 3, COMPOSE_MAP, program);
                }
            }
            return undefined;
        }
        if (sub === "exec" || sub === "run") {
            return containerCommand(input, 2, COMPOSE_MAP, "compose");
        }
        return undefined;
    }
}

function containerCommand(
    input: UnwrapInput,
    start: number,
    options: OptionMap,
    via: string,
): Unwrapped | undefined {
    const scan = scanContainer(input.argv, start, options);
    if (scan === undefined || scan.index >= input.argv.length) {
        return undefined;
    }
    const target = input.argv[scan.index]?.value;
    const commandAt = scan.index + 1;
    if (commandAt >= input.argv.length) {
        return undefined;
    }
    return commandResult(commandAt, remoteScope(via, target, scan));
}
