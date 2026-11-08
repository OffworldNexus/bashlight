/**
 * The real file system behind {@link RuleDirectoryReader}: lists the rule files
 * of a directory with their modification time and size. This is an adapter,
 * like `NodeFileSystem`; every failure degrades to "no files" instead of
 * throwing.
 */

import { readdirSync, statSync } from "node:fs";

import {
    isRuleFileName,
    type RuleDirectoryReader,
    type RuleFile,
} from "../rules/custom/index.ts";
import { join } from "../shared/posix-path.ts";

function listNames(directory: string): readonly string[] {
    try {
        return readdirSync(directory);
    } catch {
        return [];
    }
}

export class NodeRuleDirectoryReader implements RuleDirectoryReader {
    entries(directory: string): readonly RuleFile[] {
        const files: RuleFile[] = [];
        for (const name of listNames(directory)) {
            if (!isRuleFileName(name)) {
                continue;
            }
            const path = join(directory, name);
            try {
                const info = statSync(path);
                files.push({ path, mtime: info.mtimeMs, size: info.size });
            } catch {
                // A file that vanished between listing and stat is skipped.
            }
        }
        return files.sort((left, right) => left.path.localeCompare(right.path));
    }
}
