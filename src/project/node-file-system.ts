import { existsSync, readFileSync, statSync } from "node:fs";

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
}
