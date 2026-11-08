/* eslint-disable sonarjs/function-return-type */
/**
 * The file access the CLI needs on top of the core's read-only `FileSystem`:
 * the size of the audit log, directory listings (plugin discovery) and a
 * writability probe (doctor). Kept separate from `project/FileSystem` so the
 * core's interface stays minimal; in production both are the same object.
 *
 * Every method is total: an unreachable path degrades to `undefined` / `[]` /
 * `false` instead of throwing.
 */

import { accessSync, constants, existsSync, readdirSync, statSync } from "node:fs";

import { type FileSystem, NodeFileSystem } from "../project/index.ts";
import { dirname } from "../shared/posix-path.ts";

/** A `FileSystem` plus the few extra probes the CLI commands need. */
export interface CliFiles extends FileSystem {
    /** The size of `path` in bytes, or `undefined` when it cannot be read. */
    size(path: string): number | undefined;
    /** The entry names of a directory, or `[]` when it cannot be listed. */
    list(path: string): readonly string[];
    /** Whether `path` or its nearest existing ancestor is writable. */
    canWrite(path: string): boolean;
}

/** The production `CliFiles`, on top of `NodeFileSystem`. */
export class NodeCliFiles extends NodeFileSystem implements CliFiles {
    size(path: string): number | undefined {
        try {
            return statSync(path).size;
        } catch {
            return undefined;
        }
    }

    list(path: string): readonly string[] {
        try {
            return readdirSync(path).sort((left, right) => left.localeCompare(right));
        } catch {
            return [];
        }
    }

    canWrite(path: string): boolean {
        let candidate = path;
        for (;;) {
            if (existsSync(candidate)) {
                return isWritable(candidate);
            }
            const parent = dirname(candidate);
            if (parent === candidate) {
                return false;
            }
            candidate = parent;
        }
    }
}

function isWritable(path: string): boolean {
    try {
        accessSync(path, constants.W_OK);
        return true;
    } catch {
        return false;
    }
}
