/**
 * `bashlight stats` — summarise the audit log.
 *
 * Reads the log, applies the `--since` window (default 7 days) and reports
 * totals, per-rule counts, per-day outcomes, the most common rewrite pairs and
 * the busiest working directories. `--json` prints the same data as an object.
 */

import {
    AuditLogReader,
    defaultAuditLogPath,
    homeDirectory,
    type TimedAuditEntry,
} from "../../opencode/audit-log.ts";
import type { FlagSpec } from "../argv.ts";
import { parseArgv } from "../argv.ts";
import { type CliCommand, printCommandHelp, usageError } from "../command.ts";
import { parseDuration } from "../duration.ts";
import { firstWords, tildePath } from "../format.ts";
import type { CommandIo } from "../io.ts";

const SPEC: readonly FlagSpec[] = [
    { name: "log", value: true },
    { name: "since", value: true },
    { name: "json" },
];

const DEFAULT_SINCE = "7d";
const TOP_LIMIT = 10;
const REWRITE_WORDS = 2;

interface Count {
    readonly key: string;
    readonly count: number;
}

interface RewritePair {
    readonly from: string;
    readonly to: string;
    readonly count: number;
}

interface DayOutcomes {
    readonly date: string;
    readonly rewritten: number;
    readonly blocked: number;
    readonly unchanged: number;
}

export interface StatsReport {
    readonly log: string;
    readonly since: string;
    readonly totals: {
        readonly entries: number;
        readonly rewritten: number;
        readonly blocked: number;
        readonly unchanged: number;
        readonly rewrittenPercent: number;
    };
    readonly rules: readonly Count[];
    readonly days: readonly DayOutcomes[];
    readonly rewrites: readonly RewritePair[];
    readonly cwds: readonly Count[];
}

export class StatsCommand implements CliCommand {
    readonly name = "stats";
    readonly summary = "summarise the audit log";
    readonly usage = "stats [--log PATH] [--since 7d] [--json]";

    run(args: readonly string[], io: CommandIo): Promise<number> {
        return Promise.resolve(this.execute(args, io));
    }

    private execute(args: readonly string[], io: CommandIo): number {
        const parsed = parseArgv(args, SPEC);
        if (!parsed.ok) {
            return usageError(this, parsed.error, io);
        }
        if (parsed.flags.bool("help")) {
            printCommandHelp(this, io.output);
            return 0;
        }
        const since = parsed.flags.value("since") ?? DEFAULT_SINCE;
        const milliseconds = parseDuration(since);
        if (milliseconds === undefined) {
            return usageError(this, `invalid --since '${since}'`, io);
        }
        const path = parsed.flags.value("log") ?? defaultAuditLogPath(io.env);
        const entries = this.read(io, path, io.clock.now().getTime() - milliseconds);
        const report = summarise(entries, path, since);
        if (parsed.flags.bool("json")) {
            io.output.line(JSON.stringify(report, null, 2));
        } else {
            for (const line of render(report, homeDirectory(io.env))) {
                io.output.line(line);
            }
        }
        return 0;
    }

    private read(
        io: CommandIo,
        path: string,
        cutoff: number,
    ): readonly TimedAuditEntry[] {
        const text = io.files.readText(path);
        if (text === undefined) {
            return [];
        }
        return new AuditLogReader()
            .parse(text)
            .filter((entry) => Date.parse(entry.time) >= cutoff);
    }
}

/** Computes the report from the already-filtered entries. */
export function summarise(
    entries: readonly TimedAuditEntry[],
    log: string,
    since: string,
): StatsReport {
    const rewritten = countOutcome(entries, "rewritten");
    const blocked = countOutcome(entries, "blocked");
    const unchanged = countOutcome(entries, "unchanged");
    const total = entries.length;
    return {
        log,
        since,
        totals: {
            entries: total,
            rewritten,
            blocked,
            unchanged,
            rewrittenPercent: total === 0 ? 0 : Math.round((rewritten / total) * 100),
        },
        rules: rank(countsBy(entries.flatMap((entry) => entry.ruleIds))),
        days: perDay(entries),
        rewrites: rewritePairs(entries),
        cwds: rank(countsBy(entries.map((entry) => entry.cwd))),
    };
}

function countOutcome(
    entries: readonly TimedAuditEntry[],
    outcome: TimedAuditEntry["outcome"],
): number {
    return entries.filter((entry) => entry.outcome === outcome).length;
}

function countsBy(keys: readonly string[]): ReadonlyMap<string, number> {
    const counts = new Map<string, number>();
    for (const key of keys) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
}

/** Ranks counts descending, ties broken by key; capped at the top list size. */
function rank(
    counts: ReadonlyMap<string, number>,
    limit = TOP_LIMIT,
): readonly Count[] {
    return [...counts.entries()]
        .map(([key, count]) => ({ key, count }))
        .sort(
            (left, right) =>
                right.count - left.count || left.key.localeCompare(right.key),
        )
        .slice(0, limit);
}

function perDay(entries: readonly TimedAuditEntry[]): readonly DayOutcomes[] {
    const days = new Map<
        string,
        { rewritten: number; blocked: number; unchanged: number }
    >();
    for (const entry of entries) {
        const date = entry.time.slice(0, 10);
        const day = days.get(date) ?? { rewritten: 0, blocked: 0, unchanged: 0 };
        day[entry.outcome] += 1;
        days.set(date, day);
    }
    return [...days.entries()]
        .map(([date, counts]) => ({ date, ...counts }))
        .sort((left, right) => left.date.localeCompare(right.date));
}

function rewritePairs(entries: readonly TimedAuditEntry[]): readonly RewritePair[] {
    const pairs = new Map<string, { from: string; to: string; count: number }>();
    for (const entry of entries) {
        if (entry.outcome !== "rewritten" || entry.command === undefined) {
            continue;
        }
        const from = firstWords(entry.original, REWRITE_WORDS);
        const to = firstWords(entry.command, REWRITE_WORDS);
        const key = `${from} → ${to}`;
        const pair = pairs.get(key) ?? { from, to, count: 0 };
        pair.count += 1;
        pairs.set(key, pair);
    }
    return [...pairs.values()]
        .sort(
            (left, right) =>
                right.count - left.count || left.from.localeCompare(right.from),
        )
        .slice(0, TOP_LIMIT);
}

/** The human-readable rendering of a report. */
export function render(report: StatsReport, home: string): readonly string[] {
    const lines: string[] = [
        `Audit log: ${report.log}`,
        `Window: last ${report.since}`,
        "",
        `Entries:      ${report.totals.entries}`,
        `Rewritten:    ${report.totals.rewritten} (${report.totals.rewrittenPercent}%)`,
        `Blocked:      ${report.totals.blocked}`,
        `Unchanged:    ${report.totals.unchanged}`,
    ];
    lines.push("", "Rules:");
    pushCounts(lines, report.rules, (rule) => rule.key);
    lines.push("", "Outcomes per day:");
    for (const day of report.days) {
        lines.push(
            `  ${day.date}  rewritten ${day.rewritten}  blocked ${day.blocked}  unchanged ${day.unchanged}`,
        );
    }
    lines.push("", "Top rewrites:");
    pushCounts(lines, report.rewrites, (pair) => `${pair.from} → ${pair.to}`);
    lines.push("", "Top working directories:");
    pushCounts(lines, report.cwds, (cwd) => tildePath(cwd.key, home));
    return lines;
}

function pushCounts<T extends { readonly count: number }>(
    lines: string[],
    items: readonly T[],
    label: (item: T) => string,
): void {
    if (items.length === 0) {
        lines.push("  (none)");
        return;
    }
    for (const item of items) {
        lines.push(`  ${String(item.count).padStart(4)}  ${label(item)}`);
    }
}
