/**
 * The CLI composition root: the only file that reads `process.*`.
 *
 * It builds the collaborators the commands receive (the real file system, the
 * clock, the scheduler, the process runner), registers the commands and
 * dispatches. Everything the commands use is injected, so tests drive them with
 * fakes and never touch this file.
 */

import { createBashlight } from "../bashlight.ts";
import { configDirectory } from "../opencode/audit-log.ts";
import { ConsoleLogger } from "../opencode/logger.ts";
import { createRuleCatalog, createTrustStore } from "../opencode/rule-catalog.ts";
import type { FileSystem } from "../project/index.ts";
import type { Rule } from "../rules/rule.ts";
import { SystemClock } from "./clock.ts";
import { CommandRegistry, printUsage } from "./command.ts";
import { DoctorCommand } from "./commands/doctor.ts";
import { ExplainCommand } from "./commands/explain.ts";
import { HelpCommand } from "./commands/help.ts";
import { RulesCommand } from "./commands/rules.ts";
import { StatsCommand } from "./commands/stats.ts";
import { TrustCommand } from "./commands/trust.ts";
import { UntrustCommand } from "./commands/untrust.ts";
import { WatchCommand } from "./commands/watch.ts";
import { NodeCliFiles } from "./files.ts";
import type { CommandIo } from "./io.ts";
import { ConsoleOutput } from "./output.ts";
import { NodeProcessRunner } from "./process-runner.ts";
import { SystemScheduler } from "./scheduler.ts";

/** Overrides for {@link createIo}; the signal is always required. */
export interface IoOptions {
    readonly signal: AbortSignal;
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly cwd?: string;
    readonly colors?: boolean;
}

/** Builds the production `CommandIo` from the process environment. */
export function createIo(options: IoOptions): CommandIo {
    const env = options.env ?? process.env;
    const files = new NodeCliFiles();
    const configDir = configDirectory(env);
    const trust = createTrustStore(configDir);
    return {
        output: new ConsoleOutput(options.colors ?? defaultColors(env)),
        clock: new SystemClock(),
        scheduler: new SystemScheduler(),
        files,
        fileSystem: files,
        runner: new NodeProcessRunner(),
        env,
        cwd: options.cwd ?? process.cwd(),
        readStdin,
        signal: options.signal,
        processorFactory: (fileSystem: FileSystem, rules?: readonly Rule[]) =>
            createBashlight({
                fileSystem,
                ...(rules === undefined ? {} : { rules }),
            }),
        ruleAccess: createRuleCatalog({
            configDir,
            trust,
            reporter: new ConsoleLogger(),
        }),
        trust,
    };
}

/** All commands, including `help`, wired to the registry it lists. */
export function createRegistry(): CommandRegistry {
    const registry = new CommandRegistry([
        new WatchCommand(),
        new StatsCommand(),
        new ExplainCommand(),
        new RulesCommand(),
        new TrustCommand(),
        new UntrustCommand(),
        new DoctorCommand(),
    ]);
    registry.addAll([new HelpCommand(() => registry.all())]);
    return registry;
}

/** Resolves the first argv word to a command and runs it. */
export async function dispatch(
    registry: CommandRegistry,
    argv: readonly string[],
    io: CommandIo,
): Promise<number> {
    const name = argv[0];
    if (name === undefined || name === "--help" || name === "-h") {
        printUsage(registry.all(), io.output);
        return 0;
    }
    const command = registry.get(name);
    if (command === undefined) {
        io.output.line(`bashlight: unknown command '${name}'`);
        printUsage(registry.all(), io.output);
        return 2;
    }
    return command.run(argv.slice(1), io);
}

/** Reads `process.argv` and runs the CLI; used by `bin/bashlight`. */
export async function run(
    argv: readonly string[] = process.argv.slice(2),
): Promise<number> {
    const controller = new AbortController();
    const stop = (): void => controller.abort();
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    try {
        return await dispatch(
            createRegistry(),
            argv,
            createIo({ signal: controller.signal }),
        );
    } catch (error) {
        process.stderr.write(`bashlight: ${messageOf(error)}\n`);
        return 1;
    } finally {
        process.off("SIGINT", stop);
        process.off("SIGTERM", stop);
    }
}

/** One line for an unexpected failure; never throws. */
function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** Colours only on a TTY, and never when `NO_COLOR` is set. */
function defaultColors(env: Readonly<Record<string, string | undefined>>): boolean {
    return process.stdout.isTTY === true && (env.NO_COLOR ?? "") === "";
}

/** Reads the whole of stdin; a read error resolves to the empty string. */
function readStdin(): Promise<string> {
    return new Promise((resolve) => {
        const chunks: Buffer[] = [];
        process.stdin.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
        });
        process.stdin.on("end", () => {
            resolve(Buffer.concat(chunks).toString("utf8"));
        });
        process.stdin.on("error", () => {
            resolve("");
        });
        process.stdin.resume();
    });
}
