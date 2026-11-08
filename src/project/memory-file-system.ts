import { basename, dirname, normalize } from "../shared/posix-path.ts";
import type { FileSystem } from "./file-system.ts";

/**
 * A `FileSystem` backed by an in-memory tree, used by tests and corpus
 * fixtures.
 *
 * The constructor takes a map from absolute POSIX path to either the file's
 * content (`string`) or `null` for a directory. Parent directories are implied.
 */
export type FileSystemEntries = Readonly<Record<string, string | null>>;

export class MemoryFileSystem implements FileSystem {
    private readonly entries = new Map<string, string | null>();

    constructor(entries: FileSystemEntries = {}) {
        for (const [path, value] of Object.entries(entries)) {
            this.entries.set(normalize(path), value);
        }
        for (const path of [...this.entries.keys()]) {
            this.implyParents(path);
        }
        this.entries.set("/", null);
    }

    exists(path: string): boolean {
        return this.entries.has(normalize(path));
    }

    isDirectory(path: string): boolean {
        return this.entries.get(normalize(path)) === null;
    }

    readText(path: string): string | undefined {
        const value = this.entries.get(normalize(path));
        return typeof value === "string" ? value : undefined;
    }

    // eslint-disable-next-line sonarjs/function-return-type
    listDirectory(path: string): readonly string[] | undefined {
        const target = normalize(path);
        if (this.entries.get(target) !== null) {
            return undefined;
        }
        const names: string[] = [];
        for (const key of this.entries.keys()) {
            if (key !== target && dirname(key) === target) {
                names.push(basename(key));
            }
        }
        return names.sort((left, right) => left.localeCompare(right));
    }

    readHead(path: string, maxBytes: number): string | undefined {
        const value = this.readText(path);
        return value === undefined ? undefined : value.slice(0, maxBytes);
    }

    private implyParents(path: string): void {
        let parent = dirname(path);
        while (parent !== "/" && !this.entries.has(parent)) {
            this.entries.set(parent, null);
            parent = dirname(parent);
        }
    }
}
