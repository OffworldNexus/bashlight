import {
    closeSync,
    existsSync,
    openSync,
    readdirSync,
    readFileSync,
    readSync,
    statSync,
} from "node:fs";

import type { FileSystem } from "./file-system.ts";

/**
 * The real-disk `FileSystem`, used only by the composition root.
 *
 * The only file in `src/` allowed to import `node:fs`. Every call is wrapped so
 * that an inaccessible path (permissions, races, broken symlinks) degrades to
 * `false` / `undefined` instead of throwing.
 */
export class NodeFileSystem implements FileSystem {
    exists(path: string): boolean {
        try {
            return existsSync(path);
        } catch {
            return false;
        }
    }

    isDirectory(path: string): boolean {
        try {
            return statSync(path).isDirectory();
        } catch {
            return false;
        }
    }

    readText(path: string): string | undefined {
        let content: string | undefined;
        try {
            content = readFileSync(path, "utf8");
        } catch {
            content = undefined;
        }
        return content;
    }

    // eslint-disable-next-line sonarjs/function-return-type
    listDirectory(path: string): readonly string[] | undefined {
        try {
            return readdirSync(path).sort((left, right) => left.localeCompare(right));
        } catch {
            return undefined;
        }
    }

    readHead(path: string, maxBytes: number): string | undefined {
        let descriptor: number | undefined;
        let result: string | undefined;
        try {
            descriptor = openSync(path, "r");
            const buffer = Buffer.allocUnsafe(maxBytes);
            const bytesRead = readSync(descriptor, buffer, 0, maxBytes, 0);
            result = buffer.subarray(0, bytesRead).toString("utf8");
        } catch {
            result = undefined;
        }
        if (descriptor !== undefined) {
            try {
                closeSync(descriptor);
            } catch {
                // The read result is what matters; a failing close is ignored.
            }
        }
        return result;
    }
}
