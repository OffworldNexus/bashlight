/**
 * Rendering audit entries and diffs for the terminal.
 *
 * Every function takes a `colors` flag so the same code produces clean,
 * assertion-friendly text when colour is off (pipes, tests).
 */

import type { TimedAuditEntry } from "../opencode/audit-log.ts";

const ESC = "\u001b[";

/** ANSI colour codes, named by intent. */
export const COLORS = {
    red: "31",
    green: "32",
    yellow: "33",
    dim: "2",
    bold: "1",
} as const;

/** Wraps `text` in an ANSI colour when `colors` is on. */
export function paint(text: string, code: string, colors: boolean): string {
    return colors ? `${ESC}${code}m${text}${ESC}0m` : text;
}

/** Replaces a leading `$HOME/` with `~`. */
export function tildePath(path: string, home: string): string {
    if (home === "") {
        return path;
    }
    if (path === home) {
        return "~";
    }
    return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/** The short form of a session id (first eight characters). */
export function shortId(id: string): string {
    return id.length > 8 ? id.slice(0, 8) : id;
}

/** `YYYY-MM-DD HH:MM:SS` from an ISO timestamp. */
export function formatTime(iso: string): string {
    return `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
}

/** The first `count` whitespace-separated words of `command`. */
export function firstWords(command: string, count: number): string {
    return command
        .trim()
        .split(/\s+/)
        .filter((word) => word !== "")
        .slice(0, count)
        .join(" ");
}

/** Whether an entry should be shown at all (unchanged only behind `--all`). */
export function isVisible(entry: TimedAuditEntry, all: boolean): boolean {
    return all || entry.outcome !== "unchanged";
}

export interface EntryFormat {
    readonly home: string;
    readonly colors: boolean;
}

/** Renders one audit entry as the block `watch` prints. */
export function formatEntry(
    entry: TimedAuditEntry,
    format: EntryFormat,
): readonly string[] {
    const { colors } = format;
    const header = [
        formatTime(entry.time),
        shortId(entry.sessionID),
        tildePath(entry.cwd, format.home),
    ].join("  ");
    if (entry.outcome === "rewritten") {
        return [header, ...rewrittenLines(entry, colors)];
    }
    if (entry.outcome === "blocked") {
        return [
            header,
            paint(`  ${entry.original}`, COLORS.yellow, colors),
            paint(`  blocked: ${entry.message ?? ""}`, COLORS.yellow, colors),
        ];
    }
    return [header, ...unchangedLines(entry, colors)];
}

function rewrittenLines(entry: TimedAuditEntry, colors: boolean): string[] {
    const lines = [
        paint(`  - ${entry.original}`, COLORS.red, colors),
        paint(`  + ${entry.command ?? ""}`, COLORS.green, colors),
    ];
    const detail = detailLine(entry.ruleIds, entry.reasons);
    if (detail !== "") {
        lines.push(paint(`  ${detail}`, COLORS.dim, colors));
    }
    return lines;
}

function unchangedLines(entry: TimedAuditEntry, colors: boolean): string[] {
    const reason = entry.reasons.join("; ");
    const suffix = reason === "" ? "" : ` — ${reason}`;
    return [paint(`  ${entry.original}${suffix}`, COLORS.dim, colors)];
}

/** `rules: a b  reasons: x; y`, omitting empty halves. */
function detailLine(ruleIds: readonly string[], reasons: readonly string[]): string {
    const parts: string[] = [];
    if (ruleIds.length > 0) {
        parts.push(`rules: ${ruleIds.join(" ")}`);
    }
    if (reasons.length > 0) {
        parts.push(`reasons: ${reasons.join("; ")}`);
    }
    return parts.join("  ");
}
