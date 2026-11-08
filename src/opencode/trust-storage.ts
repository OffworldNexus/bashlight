/* eslint-disable sonarjs/function-return-type -- text or `undefined` */
/**
 * The real file behind {@link TrustStorage}: reads
 * `<configDir>/bashlight/trusted.json` and creates its directory before writing.
 *
 * This is an adapter, like `NodeFileSystem`; `write` may throw (a bad permissions
 * error is worth surfacing to `bashlight trust`), while `read` degrades to
 * `undefined` when the file is missing or unreadable.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import type { TrustStorage } from "../rules/custom/index.ts";
import { dirname } from "../shared/posix-path.ts";

export class NodeTrustStorage implements TrustStorage {
    constructor(private readonly path: string) {}

    read(): string | undefined {
        try {
            return readFileSync(this.path, "utf8");
        } catch {
            return undefined;
        }
    }

    write(text: string): void {
        mkdirSync(dirname(this.path), { recursive: true });
        writeFileSync(this.path, text);
    }
}
