/**
 * Refreshing a directory's custom rules before a CLI command reads them.
 *
 * Each command guards the refresh so a broken catalog can never crash the CLI:
 * the failure is printed and the command continues with the built-ins.
 */

import type { CommandIo } from "./io.ts";

export async function refreshRules(io: CommandIo, directory: string): Promise<void> {
    try {
        await io.ruleAccess.refresh(directory);
    } catch (error) {
        io.output.line(`bashlight: could not load the rules — ${messageOf(error)}`);
    }
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
