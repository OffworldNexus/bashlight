/**
 * Listing the rule files of a directory, with the metadata the cache keys on.
 *
 * The catalog needs only this from the disk, so it is injected: the production
 * adapter (under `opencode/`) reads the real file system, tests supply a map.
 * A missing directory is reported as no files, never as a throw.
 */

/** The extensions a custom rule file may use. */
export const RULE_FILE_EXTENSIONS: readonly string[] = Object.freeze([".ts", ".js"]);

/** Whether a file name is a custom rule file (`.ts` or `.js`). */
export function isRuleFileName(name: string): boolean {
    return RULE_FILE_EXTENSIONS.some((extension) => name.endsWith(extension));
}

/** One rule file on disk. */
export interface RuleFile {
    readonly path: string;
    /** Modification time in milliseconds. */
    readonly mtime: number;
    /** Size in bytes. */
    readonly size: number;
}

/** The `.ts`/`.js` rule files of one directory. */
export interface RuleDirectoryReader {
    entries(directory: string): readonly RuleFile[];
}
