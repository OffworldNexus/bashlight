/**
 * `bashlight untrust [DIR]` — stop loading a project's own rule files.
 *
 * The inverse of {@link TrustCommand}: removes the directory from the trust
 * store. Rule files are not deleted, only ignored.
 */

import { resolve } from "../../shared/posix-path.ts";
import { parseArgv } from "../argv.ts";
import { type CliCommand, printCommandHelp, usageError } from "../command.ts";
import type { CommandIo } from "../io.ts";

export class UntrustCommand implements CliCommand {
    readonly name = "untrust";
    readonly summary = "stop loading a project's rule files";
    readonly usage = "untrust [DIR]";

    run(args: readonly string[], io: CommandIo): Promise<number> {
        return Promise.resolve(this.execute(args, io));
    }

    private execute(args: readonly string[], io: CommandIo): number {
        const parsed = parseArgv(args, []);
        if (!parsed.ok) {
            return usageError(this, parsed.error, io);
        }
        if (parsed.flags.bool("help")) {
            printCommandHelp(this, io.output);
            return 0;
        }
        const directory = resolve(io.cwd, parsed.flags.positionals[0] ?? ".") ?? io.cwd;
        try {
            io.trust.untrust(directory);
        } catch (error) {
            io.output.line(
                `bashlight untrust: could not write the trust file — ${messageOf(error)}`,
            );
            return 1;
        }
        io.output.line(`untrusted ${directory}`);
        return 0;
    }
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
