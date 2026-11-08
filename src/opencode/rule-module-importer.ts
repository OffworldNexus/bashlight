/**
 * The real module importer behind {@link RuleModuleImporter}.
 *
 * Rule files are TypeScript or JavaScript loaded at runtime, so the import is
 * dynamic. The two runtimes cache differently:
 *
 * - Node keys ESM modules by their full URL, so each `v=` value is a distinct
 *   module; the old entries are never evicted, which is fine for a dev-time
 *   tool (`signature` is the whole rule directory's file list).
 * - Bun keys modules by path, so `evict` removes a directory and everything
 *   under it from `require.cache` (Bun registers ESM modules there too — the
 *   same trick OpenCode uses to reload local plugins). That is what lets an
 *   edited rule, and any helper it imports from the rules directory, reload.
 */

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import type { RuleModuleImporter } from "../rules/custom/index.ts";

const require = createRequire(import.meta.url);

export class FileRuleModuleImporter implements RuleModuleImporter {
    import(path: string, signature: string): Promise<unknown> {
        delete require.cache[path];
        const url = `${pathToFileURL(path).href}?v=${encodeURIComponent(signature)}`;
        return import(url) as Promise<unknown>;
    }

    evict(directory: string): void {
        const prefix = `${directory}/`;
        for (const key of Object.keys(require.cache)) {
            if (key === directory || key.startsWith(prefix)) {
                delete require.cache[key];
            }
        }
    }
}
