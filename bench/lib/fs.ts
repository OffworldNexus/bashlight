/* eslint-disable sonarjs/function-return-type -- file readers return undefined when absent */
/**
 * The filesystem port the benchmark adapters depend on.
 *
 * As in the rest of bashlight, the adapters take an interface so the pure
 * parts stay testable; `NodeBenchFileSystem` is the only implementation that
 * touches the disk.
 */

import {
    cpSync,
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    rmSync,
    statfsSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

export interface BenchFileSystem {
    /** Creates a directory and its parents. */
    mkdirp(path: string): void;
    /** Writes a file, creating its parent directory. */
    writeFile(path: string, content: string): void;
    /** Reads a UTF-8 file, or `undefined` when it is absent. */
    readFile(path: string): string | undefined;
    exists(path: string): boolean;
    isDirectory(path: string): boolean;
    /** Lists the entries of a directory, empty when it does not exist. */
    readDirectory(path: string): readonly string[];
    /** Copies a directory tree, skipping the paths `skip` accepts. */
    copyTree(from: string, to: string, skip: (path: string) => boolean): void;
    /** Removes a file or directory tree, ignoring a missing target. */
    remove(path: string): void;
}

/** Directories with nothing a checker or a diff ever needs to read. */
export const IGNORED_DIRECTORIES = new Set([
    ".git",
    ".venv",
    "venv",
    "node_modules",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
]);

/**
 * Recursively collects file paths under `directory` matching `wanted`,
 * skipping the directories in {@link IGNORED_DIRECTORIES}.
 */
export function walkFiles(
    fs: BenchFileSystem,
    directory: string,
    wanted: (path: string) => boolean,
): readonly string[] {
    const found: string[] = [];
    for (const entry of fs.readDirectory(directory)) {
        if (IGNORED_DIRECTORIES.has(entry)) {
            continue;
        }
        const path = `${directory}/${entry}`;
        if (fs.isDirectory(path)) {
            found.push(...walkFiles(fs, path, wanted));
        } else if (wanted(path)) {
            found.push(path);
        }
    }
    return found;
}

/** Free bytes on the filesystem holding `path` (statfs, no shell). */
export function nodeFreeBytes(path: string): number {
    try {
        const stats = statfsSync(path);
        return stats.bavail * stats.bsize;
    } catch {
        return Number.POSITIVE_INFINITY;
    }
}

/** The real filesystem. */
export class NodeBenchFileSystem implements BenchFileSystem {
    mkdirp(path: string): void {
        mkdirSync(path, { recursive: true });
    }

    writeFile(path: string, content: string): void {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, content, "utf8");
    }

    readFile(path: string): string | undefined {
        if (!existsSync(path) || !statSync(path).isFile()) {
            return undefined;
        }
        return readFileSync(path, "utf8");
    }

    exists(path: string): boolean {
        return existsSync(path);
    }

    isDirectory(path: string): boolean {
        return existsSync(path) && statSync(path).isDirectory();
    }

    readDirectory(path: string): readonly string[] {
        return existsSync(path) ? readdirSync(path) : [];
    }

    copyTree(from: string, to: string, skip: (path: string) => boolean): void {
        cpSync(from, to, { recursive: true, filter: (source) => !skip(source) });
    }

    remove(path: string): void {
        rmSync(path, { recursive: true, force: true });
    }
}
