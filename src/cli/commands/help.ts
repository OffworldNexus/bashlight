/**
 * `bashlight help` — the usage listing, and per-command help.
 *
 * The catalog is a lazy getter so the command can be registered alongside the
 * commands it lists without a construction cycle.
 */

import { type CliCommand, printCommandHelp, printUsage } from "../command.ts";
import type { CommandIo } from "../io.ts";

export class HelpCommand implements CliCommand {
    readonly name = "help";
    readonly summary = "show this help";
    readonly usage = "help [command]";

    constructor(private readonly catalog: () => readonly CliCommand[]) {}

    run(args: readonly string[], io: CommandIo): Promise<number> {
        return Promise.resolve(this.execute(args, io));
    }

    private execute(args: readonly string[], io: CommandIo): number {
        const wanted = args[0];
        const commands = this.catalog();
        const command =
            wanted === undefined
                ? undefined
                : commands.find((candidate) => candidate.name === wanted);
        if (command === undefined) {
            printUsage(commands, io.output);
            return 0;
        }
        printCommandHelp(command, io.output);
        return 0;
    }
}
