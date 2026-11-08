/**
 * Listing the rule files of a directory, with their modification times.
 *
 * The catalog needs only this from the disk, so it is injected: the production
 * adapter (under `opencode/`) reads the real file system, tests supply a map.
 * A missing directory is reported as no files, never as a throw.
 */

/** One rule file on disk. */
export interface RuleFile {
    readonly path: string;
    /** Modification time in milliseconds, used to invalidate the cache. */
    readonly mtime: number;
}

/** The `.ts`/`.js` rule files of one directory. */
export interface RuleDirectoryReader {
    entries(directory: string): readonly RuleFile[];
}
