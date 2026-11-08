/* eslint-disable sonarjs/function-return-type */
/**
 * `bashlight explain <command…>` — a dry run.
 *
 * Runs the real pipeline against the real file system (or whatever
 * `io.fileSystem` is) with the current process environment, so it shows exactly
 * what the plugin would do. The command is either one quoted argument or the
 * remaining arguments joined with spaces; `-` reads it from stdin.
 */

import type { Change, Outcome } from "../../outcome.ts";
import { resolve } from "../../shared/posix-path.ts";
import type { FlagSpec } from "../argv.ts";
import { parseArgv } from "../argv.ts";
import { type CliCommand, printCommandHelp, usageError } from "../command.ts";
import { COLORS, paint } from "../format.ts";
import type { CommandIo } from "../io.ts";

const SPEC: readonly FlagSpec[] = [
    { name: "cwd", value: true },
    { name: "env-file", value: true },
    { name: "no-color" },
];

export class ExplainCommand implements CliCommand {
    readonly name = "explain";
    readonly summary = "show what bashlight would do to a command";
    readonly usage = "explain <command…> [--cwd DIR] [--env-file F]";

    async run(args: readonly string[], io: CommandIo): Promise<number> {
        const parsed = parseArgv(args, SPEC, { unknownAsPositional: true });
        if (!parsed.ok) {
            return usageError(this, parsed.error, io);
        }
        if (parsed.flags.bool("help")) {
            printCommandHelp(this, io.output);
            return 0;
        }
        const command = await this.command(parsed.flags.positionals, io);
        if (command === undefined) {
            return usageError(this, "no command given", io);
        }
        const envFile = parsed.flags.value("env-file");
        const env = this.environment(envFile, io);
        if (env === false) {
            return usageError(this, `cannot read --env-file '${envFile ?? ""}'`, io);
        }
        const cwd = resolve(io.cwd, parsed.flags.value("cwd") ?? ".") ?? io.cwd;
        const colors = io.output.colors && !parsed.flags.bool("no-color");
        const outcome = io
            .processorFactory(io.fileSystem)
            .process({ command, cwd, env });
        for (const line of render(outcome, command, colors)) {
            io.output.line(line);
        }
        return 0;
    }

    /** The command text, from the positionals or stdin; `undefined` when empty. */
    private async command(
        positionals: readonly string[],
        io: CommandIo,
    ): Promise<string | undefined> {
        const joined = positionals.join(" ").trim();
        if (joined === "") {
            return undefined;
        }
        if (joined === "-") {
            const text = (await io.readStdin()).trim();
            return text === "" ? undefined : text;
        }
        return joined;
    }

    /** The process environment overlaid with `--env-file`; `false` on a bad file. */
    private environment(
        envFile: string | undefined,
        io: CommandIo,
    ): Record<string, string> | false {
        const base = presentEnv(io.env);
        if (envFile === undefined) {
            return base;
        }
        const path = resolve(io.cwd, envFile) ?? envFile;
        const text = io.files.readText(path);
        return text === undefined ? false : { ...base, ...parseEnvFile(text) };
    }
}

/** The environment without the `undefined`-valued entries. */
function presentEnv(
    env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
        if (value !== undefined) {
            result[key] = value;
        }
    }
    return result;
}

/** A lenient `.env` parser: `KEY=VALUE`, `#` comments, optional quotes. */
function parseEnvFile(text: string): Record<string, string> {
    const env: Record<string, string> = {};
    for (const raw of text.split("\n")) {
        const line = raw.trim();
        if (line === "" || line.startsWith("#")) {
            continue;
        }
        const equals = line.indexOf("=");
        if (equals <= 0) {
            continue;
        }
        const key = line.slice(0, equals).trim();
        env[key] = unquote(line.slice(equals + 1).trim());
    }
    return env;
}

function unquote(value: string): string {
    const quoted =
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"));
    return quoted && value.length >= 2 ? value.slice(1, -1) : value;
}

/** Renders the outcome as the terminal lines `explain` prints. */
export function render(
    outcome: Outcome,
    original: string,
    colors: boolean,
): readonly string[] {
    if (outcome.kind === "rewritten") {
        const lines = [
            "rewritten:",
            paint(`  - ${original}`, COLORS.red, colors),
            paint(`  + ${outcome.command}`, COLORS.green, colors),
        ];
        if (outcome.changes.length > 0) {
            lines.push("changes:");
            for (const change of outcome.changes) {
                lines.push(...renderChange(change, colors));
            }
        }
        return lines;
    }
    if (outcome.kind === "blocked") {
        return ["blocked:", paint(`  ${outcome.message}`, COLORS.yellow, colors)];
    }
    return [
        outcome.reason === undefined ? "unchanged" : `unchanged: ${outcome.reason}`,
    ];
}

function renderChange(change: Change, colors: boolean): string[] {
    const label = [
        change.ruleIds.length > 0 ? `rules: ${change.ruleIds.join(" ")}` : "",
        change.reasons.length > 0 ? `reasons: ${change.reasons.join("; ")}` : "",
    ]
        .filter((part) => part !== "")
        .join("  ");
    return [
        `  - ${label}`,
        paint(`      ${change.before} → ${change.after}`, COLORS.dim, colors),
    ];
}
