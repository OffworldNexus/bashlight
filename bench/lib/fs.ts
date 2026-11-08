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
