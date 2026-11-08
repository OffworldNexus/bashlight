/**
 * Read-only view of the filesystem the project inspector needs.
 *
 * Every path is an absolute POSIX path. Implementations never throw: an
 * unreachable or missing path is reported as `false` / `undefined`, so a
 * permission error degrades to "not a project" instead of breaking a command.
 */
export interface FileSystem {
    exists(path: string): boolean;
    isDirectory(path: string): boolean;
    readText(path: string): string | undefined;
    /**
     * The names of the entries (files and sub-directories, not paths) directly
     * inside `path`, or `undefined` when it cannot be listed. A missing path,
     * a file, or an unreadable directory degrades to `undefined`.
     */
    listDirectory(path: string): readonly string[] | undefined;
    /**
     * The first `maxBytes` of `path`, or `undefined` when it cannot be read.
     * Used to read shebangs without loading whole (possibly binary) files.
     * "maxBytes" is approximate: `MemoryFileSystem` slices UTF-16 code units,
     * `NodeFileSystem` reads bytes and decodes them as UTF-8.
     */
    readHead(path: string, maxBytes: number): string | undefined;
}
