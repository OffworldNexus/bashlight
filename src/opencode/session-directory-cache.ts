/**
 * A tiny LRU cache of per-session working directories.
 *
 * `lookup` may fail (the session may not be readable yet); a failure is logged
 * and the fallback directory (the project location) is returned *without*
 * caching, so the next call retries and can still learn the real directory.
 * Successes are cached and evicted least-recently-used first.
 */

import type { Logger } from "./logger.ts";

const DEFAULT_MAX_ENTRIES = 256;

/** Collaborators of a {@link SessionDirectoryCache}. */
export interface SessionDirectoryCacheOptions {
    /** The real lookup; may reject. */
    readonly lookup: (sessionID: string) => Promise<string>;
    /** Returned when `lookup` fails; never cached. */
    readonly fallback: string;
    readonly logger: Logger;
    /** Maximum cached directories before the LRU entry is evicted. */
    readonly maxEntries?: number;
}

export class SessionDirectoryCache {
    private readonly cache = new Map<string, string>();
    private readonly maxEntries: number;

    constructor(private readonly options: SessionDirectoryCacheOptions) {
        this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    }

    /** The directory for `sessionID`, cached only after a successful lookup. */
    async directoryFor(sessionID: string): Promise<string> {
        const cached = this.cache.get(sessionID);
        if (cached !== undefined) {
            this.touch(sessionID, cached);
            return cached;
        }
        try {
            const directory = await this.options.lookup(sessionID);
            this.store(sessionID, directory);
            return directory;
        } catch (error) {
            this.options.logger.error(
                "could not resolve the session directory; using the project directory",
                error,
            );
            return this.options.fallback;
        }
    }

    private store(sessionID: string, directory: string): void {
        this.cache.set(sessionID, directory);
        if (this.cache.size > this.maxEntries) {
            const leastRecent = this.cache.keys().next().value;
            if (leastRecent !== undefined) {
                this.cache.delete(leastRecent);
            }
        }
    }

    private touch(sessionID: string, directory: string): void {
        // Re-insert so the entry moves to the most-recently-used end.
        this.cache.delete(sessionID);
        this.cache.set(sessionID, directory);
    }
}
