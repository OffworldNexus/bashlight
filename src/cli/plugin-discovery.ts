/* eslint-disable sonarjs/function-return-type -- a match or `undefined` */
/**
 * Finding the bashlight plugin in an OpenCode installation.
 *
 * Accepts every way the plugin can be enabled today: a package entry in the
 * `plugins`/`plugin` array of an `opencode.json`(c) (project root,
 * `<project>/.opencode/`, or the global config directory), as a bare string or
 * a `{ package, options }` object, naming any of the supported spellings; and
 * the legacy auto-discovered `.opencode/plugins/*.ts` file.
 *
 * Nothing here is fatal: a config that cannot be parsed still counts when it
 * names bashlight, and a missing file is simply not a match.
 */

import { isRuleFileName } from "../rules/custom/index.ts";
import { isRecord } from "../shared/guards.ts";
import { join } from "../shared/posix-path.ts";
import type { CliFiles } from "./files.ts";

/** What installation evidence was found, and where. */
export interface PluginDiscovery {
    readonly found: boolean;
    readonly details: readonly string[];
}

/** The JSON to add to `opencode.json` when the plugin is missing. */
export const INSTALL_SNIPPET = `"plugins": ["github:OffworldNexus/bashlight"]`;

/** The folder OpenCode auto-discovers legacy plugin files in. */
const PLUGIN_DIRECTORY = "plugins";

/** Where the plugin's own entry point is re-exported from. */
const PLUGIN_REFERENCE = "opencode/plugin";

export function discoverPlugin(
    files: CliFiles,
    project: string,
    configDir: string,
): PluginDiscovery {
    const details: string[] = [];
    const localPlugin = findLegacyPlugin(files, join(project, ".opencode"));
    if (localPlugin !== undefined) {
        details.push(`project: ${localPlugin}`);
    }
    const globalPlugin = findLegacyPlugin(files, configDir);
    if (globalPlugin !== undefined) {
        details.push(`global: ${globalPlugin}`);
    }
    for (const config of [
        join(project, "opencode.json"),
        join(project, "opencode.jsonc"),
        join(project, ".opencode", "opencode.json"),
        join(project, ".opencode", "opencode.jsonc"),
        join(configDir, "opencode.json"),
        join(configDir, "opencode.jsonc"),
    ]) {
        if (configNamesBashlight(files.readText(config))) {
            details.push(`config: ${config}`);
        }
    }
    return { found: details.length > 0, details };
}

/** A `.ts`/`.js` file in the `plugins` folder that re-exports the plugin. */
function findLegacyPlugin(files: CliFiles, root: string): string | undefined {
    return findPluginFile(files, join(root, PLUGIN_DIRECTORY));
}

function findPluginFile(files: CliFiles, directory: string): string | undefined {
    for (const name of files.list(directory)) {
        if (!isRuleFileName(name)) {
            continue;
        }
        const path = join(directory, name);
        const text = files.readText(path);
        const mentions =
            name.toLowerCase().includes("bashlight") ||
            (text !== undefined &&
                (text.includes("bashlight") || text.includes(PLUGIN_REFERENCE)));
        if (mentions) {
            return path;
        }
    }
    return undefined;
}

/** Whether an opencode config's `plugins`/`plugin` names bashlight. */
export function configNamesBashlight(text: string | undefined): boolean {
    if (text === undefined || !text.includes("bashlight")) {
        return false;
    }
    try {
        const parsed: unknown = JSON.parse(text);
        if (isRecord(parsed)) {
            const plugins = parsed["plugins"] ?? parsed["plugin"];
            return Array.isArray(plugins) && plugins.some(isBashlightEntry);
        }
    } catch {
        // A jsonc file we cannot parse still counts when it names bashlight.
    }
    return true;
}

/** Whether one `plugins` entry names bashlight, in string or object form. */
function isBashlightEntry(entry: unknown): boolean {
    if (typeof entry === "string") {
        return isBashlightSpec(entry);
    }
    const pkg = isRecord(entry) ? entry["package"] : undefined;
    return typeof pkg === "string" && isBashlightSpec(pkg);
}

/** The accepted spellings of the bashlight package. */
export function isBashlightSpec(value: string): boolean {
    if (value === "bashlight" || value === "github:OffworldNexus/bashlight") {
        return true;
    }
    if (/^github:OffworldNexus\/bashlight(#[^/]*)?$/.test(value)) {
        return true;
    }
    return /^git\+https:\/\/github\.com\/OffworldNexus\/bashlight(\.git)?(#[^/]*)?$/.test(
        value,
    );
}
