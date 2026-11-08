/**
 * The real file system behind {@link RuleDirectoryReader}: lists the rule files
 * of a directory with their modification times. This is an adapter, like
 * `NodeFileSystem`; every failure degrades to "no files" instead of throwing.
 */

import { readdirSync, statSync } from "node:fs";

import type { RuleDirectoryReader, RuleFile } from "../rules/custom/index.ts";
import { join } from "../shared/posix-path.ts";

const RULE_EXTENSIONS: readonly string[] = Object.freeze([".ts", ".js"]);

function isRuleFile(name: string): boolean {
    return RULE_EXTENSIONS.some((extension) => name.endsWith(extension));
}

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
            if (!isRuleFile(name)) {
                continue;
            }
            const path = join(directory, name);
            try {
                files.push({ path, mtime: statSync(path).mtimeMs });
            } catch {
                // A file that vanished between listing and stat is skipped.
            }
        }
        return files.sort((left, right) => left.path.localeCompare(right.path));
    }
}
