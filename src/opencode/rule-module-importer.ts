/**
 * The real module importer behind {@link RuleModuleImporter}.
 *
 * Rule files are TypeScript or JavaScript loaded at runtime, so the import is
 * dynamic. Two runtimes cache differently: Node keys modules by URL, so the
 * `?mtime=` query busts the cache; Bun keys them by path, so the entry must be
 * removed from `require.cache` (Bun registers ESM modules there too — this is
 * the same trick OpenCode uses to reload local plugins). Doing both makes an
 * edited rule a new module in either runtime.
 */

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import type { RuleModuleImporter } from "../rules/custom/index.ts";

const require = createRequire(import.meta.url);

export class FileRuleModuleImporter implements RuleModuleImporter {
    import(path: string, version: number): Promise<unknown> {
        delete require.cache[path];
        const url = `${pathToFileURL(path).href}?mtime=${String(version)}`;
        return import(/* @vite-ignore */ url) as Promise<unknown>;
    }
}
