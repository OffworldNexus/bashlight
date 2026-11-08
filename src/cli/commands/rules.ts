/**
 * `bashlight rules` — list the rules in effect, in priority order.
 *
 * It resolves the same catalog the plugin uses (project files, global files,
 * then the built-ins), so what it prints is what will run. Disabled rules, load
 * failures and untrusted project rules are shown too, which is the quickest way
 * to debug a custom rule that never fires.
 */

import type { CatalogReport, CatalogRule } from "../../rules/custom/index.ts";
import { resolve } from "../../shared/posix-path.ts";
import type { FlagSpec } from "../argv.ts";
import { parseArgv } from "../argv.ts";
import { type CliCommand, printCommandHelp, usageError } from "../command.ts";
import type { CommandIo } from "../io.ts";
import { refreshRules } from "../refresh-rules.ts";

const SPEC: readonly FlagSpec[] = [{ name: "cwd", value: true }];

export class RulesCommand implements CliCommand {
    readonly name = "rules";
    readonly summary = "list the rules in effect";
    readonly usage = "rules [--cwd DIR]";

    async run(args: readonly string[], io: CommandIo): Promise<number> {
        const parsed = parseArgv(args, SPEC);
        if (!parsed.ok) {
            return usageError(this, parsed.error, io);
        }
        if (parsed.flags.bool("help")) {
            printCommandHelp(this, io.output);
            return 0;
        }
        const cwd = resolve(io.cwd, parsed.flags.value("cwd") ?? ".") ?? io.cwd;
        await refreshRules(io, cwd);
        for (const line of render(io.ruleAccess.report(cwd), cwd)) {
            io.output.line(line);
        }
        return 0;
    }
}

/** The terminal rendering of a catalog report. */
export function render(report: CatalogReport, directory: string): readonly string[] {
    const active = report.rules.filter((rule) => !rule.disabled);
    const disabled = report.rules.filter((rule) => rule.disabled);
    const lines: string[] = [`bashlight rules in ${directory}`, ""];
    if (!report.customRulesEnabled) {
        lines.push("Custom rules are disabled (customRules: false).", "");
    }
    if (report.untrusted !== undefined) {
        const { files, directory: project } = report.untrusted;
        lines.push(
            `${String(files)} project rule file(s) found but not trusted — run \`bashlight trust ${project}\``,
            "",
        );
    }
    lines.push("Active:");
    if (active.length === 0) {
        lines.push("  (none)");
    }
    for (const [index, rule] of active.entries()) {
        lines.push(`  ${String(index + 1).padStart(2)}  ${describe(rule)}`);
    }
    if (disabled.length > 0) {
        lines.push("", "Disabled:");
        for (const rule of disabled) {
            lines.push(`      ${describe(rule)}`);
        }
    }
    if (report.errors.length > 0) {
        lines.push("", "Failed to load:");
        for (const error of report.errors) {
            lines.push(`  ${error.path} — ${error.message}`);
        }
    }
    return lines;
}

/** `id  source  path`, aligned with the source column. */
function describe(rule: CatalogRule): string {
    const source =
        rule.path === undefined ? rule.source : `${rule.source}  ${rule.path}`;
    return `${rule.id.padEnd(18)}${source}`;
}
