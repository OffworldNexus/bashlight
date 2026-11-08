/**
 * `bashlight trust [DIR]` — allow a project's own rule files to load.
 *
 * Project rule files run with the full privileges of the OpenCode process, so
 * they stay disabled until the project directory is trusted. This command adds
 * the directory to the trust store and prints the rule files it enables.
 */

import { isRuleFileName } from "../../rules/custom/index.ts";
import { join, resolve } from "../../shared/posix-path.ts";
import { parseArgv } from "../argv.ts";
import { type CliCommand, printCommandHelp, usageError } from "../command.ts";
import type { CommandIo } from "../io.ts";

export class TrustCommand implements CliCommand {
    readonly name = "trust";
    readonly summary = "trust a project so its rule files load";
    readonly usage = "trust [DIR]";

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
            io.trust.trust(directory);
        } catch (error) {
            io.output.line(
                `bashlight trust: could not write the trust file — ${messageOf(error)}`,
            );
            return 1;
        }
        io.output.line(`trusted ${directory}`);
        const files = ruleFilesAt(io, directory);
        if (files.length === 0) {
            io.output.line("  no rule files found (yet)");
        } else {
            for (const file of files) {
                io.output.line(`  enables ${file}`);
            }
        }
        return 0;
    }
}

/** The rule files the trust decision would enable. */
function ruleFilesAt(io: CommandIo, directory: string): readonly string[] {
    const rules = join(directory, ".opencode", "bashlight", "rules");
    return io.files
        .list(rules)
        .filter(isRuleFileName)
        .map((name) => join(rules, name));
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
