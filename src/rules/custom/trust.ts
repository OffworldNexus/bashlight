/**
 * Which project directories are allowed to load their own rule files.
 *
 * A project's rule files run with the full privileges of the OpenCode process,
 * so they are treated like a direnv `.envrc`: they are only loaded once the
 * project directory has been explicitly trusted. Global rules live in the
 * user's own config directory and are always trusted.
 *
 * The store is a JSON array of absolute directory paths; trusting a directory
 * trusts everything under it. The storage is injected, so this module stays
 * pure and testable.
 */

import { isInside, normalizeAbsolute } from "../../shared/posix-path.ts";

/** Reads and writes the raw trust file. Implementations may throw on write. */
export interface TrustStorage {
    read(): string | undefined;
    write(text: string): void;
}

/** Read side of the trust store. */
export interface TrustStore {
    isTrusted(directory: string): boolean;
    list(): readonly string[];
}

/** Read/write side, used by `bashlight trust` / `bashlight untrust`. */
export interface MutableTrustStore extends TrustStore {
    trust(directory: string): void;
    untrust(directory: string): void;
}

export class JsonTrustStore implements MutableTrustStore {
    constructor(private readonly storage: TrustStorage) {}

    /** Whether `directory` is, or is inside, a trusted directory. */
    isTrusted(directory: string): boolean {
        return this.list().some((root) => isInside(directory, root));
    }

    /** Every trusted directory, innermost entries as written. */
    list(): readonly string[] {
        const text = this.storage.read();
        if (text === undefined) {
            return [];
        }
        try {
            const parsed: unknown = JSON.parse(text);
            if (!Array.isArray(parsed)) {
                return [];
            }
            return parsed.filter(
                (value): value is string =>
                    typeof value === "string" && value.startsWith("/"),
            );
        } catch {
            return [];
        }
    }

    trust(directory: string): void {
        const root = normalizeAbsolute(directory);
        const roots = new Set(this.list());
        roots.add(root);
        this.storage.write(serialize([...roots].sort((a, b) => a.localeCompare(b))));
    }

    untrust(directory: string): void {
        const root = normalizeAbsolute(directory);
        this.storage.write(serialize(this.list().filter((item) => item !== root)));
    }
}

/** The JSON array of trusted directories, one per line for readable diffs. */
function serialize(directories: readonly string[]): string {
    return `${JSON.stringify(directories, null, 4)}\n`;
}
