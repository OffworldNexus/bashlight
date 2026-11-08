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
}
