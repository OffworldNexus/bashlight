/**
 * Incremental reading of an append-only JSONL audit log.
 *
 * The follower remembers the text it has already parsed (and any incomplete
 * trailing line), so each `poll` yields only the entries that appeared since the
 * previous one. A file that shrank or was replaced is detected and re-read from
 * the start. It performs no I/O policy of its own: the caller owns the loop.
 */

import { AuditLogReader, type TimedAuditEntry } from "../opencode/audit-log.ts";
import type { CliFiles } from "./files.ts";

/** What one poll of the log produced. */
export interface FollowTick {
    /** Entries that are new since the previous poll (or the whole file). */
    readonly entries: readonly TimedAuditEntry[];
    /** The file shrank or its prefix changed: it was truncated or rotated. */
    readonly rotated: boolean;
    /** The file does not exist (report it once). */
    readonly waiting: boolean;
}

export class LogFollower {
    private readonly reader = new AuditLogReader();
    private baseline = "";
    private pending = "";
    private lastSize = 0;
    private announcedMissing = false;

    constructor(
        private readonly files: CliFiles,
        private readonly path: string,
    ) {}

    /** Entries currently in the file; primes the follower for later polls. */
    prime(): readonly TimedAuditEntry[] {
        const text = this.files.readText(this.path);
        if (text === undefined) {
            this.reset();
            return [];
        }
        this.baseline = text;
        this.lastSize = this.files.size(this.path) ?? text.length;
        const split = this.split(text);
        this.pending = split.rest;
        return split.entries;
    }

    /** New entries since the last poll, plus rotation/waiting signals. */
    poll(): FollowTick {
        const text = this.files.readText(this.path);
        if (text === undefined) {
            const waiting = !this.announcedMissing;
            this.announcedMissing = true;
            this.reset();
            return { entries: [], rotated: false, waiting };
        }
        this.announcedMissing = false;
        const size = this.files.size(this.path) ?? text.length;
        const rotated = size < this.lastSize || !text.startsWith(this.baseline);
        const chunk = rotated ? text : text.slice(this.baseline.length);
        this.baseline = text;
        this.lastSize = size;
        const source = rotated ? text : this.pending + chunk;
        const split = this.split(source);
        this.pending = split.rest;
        return { entries: split.entries, rotated, waiting: false };
    }

    private reset(): void {
        this.baseline = "";
        this.pending = "";
        this.lastSize = 0;
    }

    /** Parses the complete lines of `text`, keeping any partial last line. */
    private split(text: string): {
        readonly entries: readonly TimedAuditEntry[];
        readonly rest: string;
    } {
        const lastNewline = text.lastIndexOf("\n");
        if (lastNewline === -1) {
            return { entries: [], rest: text };
        }
        return {
            entries: this.reader.parse(text.slice(0, lastNewline)),
            rest: text.slice(lastNewline + 1),
        };
    }
}
