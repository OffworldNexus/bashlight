/**
 * The command contract and its registry.
 *
 * Every command is a small class: a name, a one-line summary, a usage line and a
 * `run` returning the process exit code. The registry renders the usage listing
 * and dispatches by name.
 */

import type { CommandIo } from "./io.ts";
import type { Output } from "./output.ts";

/** One subcommand of the `bashlight` CLI. */
export interface CliCommand {
    /** The word the user types: `bashlight <name>`. */
    readonly name: string;
    /** One line shown in the command list. */
    readonly summary: string;
    /** The syntax line, without the leading `bashlight`. */
    readonly usage: string;
    /** Runs the command; returns the process exit code. */
    run(args: readonly string[], io: CommandIo): Promise<number>;
}

/** An ordered set of commands, addressable by name. */
export class CommandRegistry {
    private readonly byName = new Map<string, CliCommand>();

    constructor(commands: readonly CliCommand[]) {
        this.addAll(commands);
    }

    addAll(commands: readonly CliCommand[]): void {
        for (const command of commands) {
            this.byName.set(command.name, command);
        }
    }

    get(name: string): CliCommand | undefined {
        return this.byName.get(name);
    }

    all(): readonly CliCommand[] {
        return [...this.byName.values()];
    }
}

/** Prints the top-level usage listing. */
export function printUsage(commands: readonly CliCommand[], output: Output): void {
    output.line("bashlight — check and debug the bashlight OpenCode plugin");
    output.line();
    output.line("Usage: bashlight <command> [options]");
    output.line();
    output.line("Commands:");
    for (const command of commands) {
        output.line(`  ${command.name.padEnd(10)}${command.summary}`);
    }
    output.line();
    output.line("Run 'bashlight <command> --help' for command-specific options.");
}

/** Prints one command's usage, shown on `--help` and on usage errors. */
export function printCommandHelp(command: CliCommand, output: Output): void {
    output.line(`Usage: bashlight ${command.usage}`);
    output.line();
    output.line(command.summary);
}

/** Reports a bad invocation and returns the usage-error exit code (2). */
export function usageError(command: CliCommand, error: string, io: CommandIo): number {
    io.output.line(`bashlight ${command.name}: ${error}`);
    printCommandHelp(command, io.output);
    return 2;
}
