/* eslint-disable sonarjs/function-return-type */
/**
 * `bashlight watch` — follow the audit log in real time.
 *
 * Prints the current tail (the last 20 entries, or everything inside `--since`),
 * then polls the file and prints each new entry as a block. Unchanged calls are
 * hidden unless `--all`. Missing files, truncation and rotation are all handled;
 * Ctrl-C aborts the loop through the injected signal.
 */

import {
    defaultAuditLogPath,
    homeDirectory,
    type TimedAuditEntry,
} from "../../opencode/audit-log.ts";
import type { FlagSpec } from "../argv.ts";
import { parseArgv } from "../argv.ts";
import { type CliCommand, printCommandHelp, usageError } from "../command.ts";
import { parseDuration } from "../duration.ts";
import { COLORS, type EntryFormat, formatEntry, isVisible, paint } from "../format.ts";
import type { CommandIo } from "../io.ts";
import { LogFollower } from "../log-follower.ts";

const SPEC: readonly FlagSpec[] = [
    { name: "log", value: true },
    { name: "all" },
    { name: "since", value: true },
    { name: "no-color" },
];

/** How many existing entries the tail shows when `--since` is absent. */
const TAIL_ENTRIES = 20;
/** How often the log is polled while following. */
const POLL_MILLISECONDS = 300;

export class WatchCommand implements CliCommand {
    readonly name = "watch";
    readonly summary = "follow the audit log in real time";
    readonly usage = "watch [--log PATH] [--all] [--since 10m] [--no-color]";

    async run(args: readonly string[], io: CommandIo): Promise<number> {
        const parsed = parseArgv(args, SPEC);
        if (!parsed.ok) {
            return usageError(this, parsed.error, io);
        }
        if (parsed.flags.bool("help")) {
            printCommandHelp(this, io.output);
            return 0;
        }
        const cutoff = this.cutoff(parsed.flags.value("since"), io);
        if (cutoff === false) {
            return usageError(
                this,
                `invalid --since '${parsed.flags.value("since")}'`,
                io,
            );
        }
        const path = parsed.flags.value("log") ?? defaultAuditLogPath(io.env);
        const all = parsed.flags.bool("all");
        const colors = io.output.colors && !parsed.flags.bool("no-color");
        const format: EntryFormat = { home: homeDirectory(io.env), colors };

        const follower = new LogFollower(io.files, path);
        for (const entry of this.tail(follower.prime(), cutoff)) {
            this.print(entry, all, format, io);
        }

        while (!io.signal.aborted) {
            await io.scheduler.sleep(POLL_MILLISECONDS, io.signal);
            if (io.signal.aborted) {
                break;
            }
            const tick = follower.poll();
            if (tick.waiting) {
                io.output.line(paint(`waiting for ${path} …`, COLORS.dim, colors));
            }
            if (tick.rotated) {
                io.output.line(
                    paint(`-- ${path} was truncated or rotated --`, COLORS.dim, colors),
                );
            }
            for (const entry of tick.entries) {
                this.print(entry, all, format, io);
            }
        }
        return 0;
    }

    /** The cutoff instant in ms, `undefined` when `--since` is absent, `false` when bad. */
    private cutoff(
        since: string | undefined,
        io: CommandIo,
    ): number | undefined | false {
        if (since === undefined) {
            return undefined;
        }
        const milliseconds = parseDuration(since);
        return milliseconds === undefined
            ? false
            : io.clock.now().getTime() - milliseconds;
    }

    /** The entries the initial tail shows: the `--since` window, or the last 20. */
    private tail(
        entries: readonly TimedAuditEntry[],
        cutoff: number | undefined,
    ): readonly TimedAuditEntry[] {
        return cutoff === undefined
            ? entries.slice(-TAIL_ENTRIES)
            : entries.filter((entry) => Date.parse(entry.time) >= cutoff);
    }

    private print(
        entry: TimedAuditEntry,
        all: boolean,
        format: EntryFormat,
        io: CommandIo,
    ): void {
        if (!isVisible(entry, all)) {
            return;
        }
        for (const line of formatEntry(entry, format)) {
            io.output.line(line);
        }
        io.output.line();
    }
}
