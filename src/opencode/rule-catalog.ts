/**
 * The one place that builds a {@link RuleCatalog} with the real adapters (the
 * file-system reader, the runtime importer, the timeout and the trust store).
 *
 * Both composition roots use it: the OpenCode plugin and the CLI. The CLI also
 * passes the shared trust store so `bashlight trust` / `bashlight untrust`
 * write the same file the catalog reads.
 */

import {
    createRuleHelpers,
    JsonTrustStore,
    RuleCatalog,
    type RuleDeadline,
    RuleDirectories,
    type RuleLoadReporter,
    RuleModuleLoader,
    type TrustStore,
} from "../rules/custom/index.ts";
import type { Rule } from "../rules/rule.ts";
import { join } from "../shared/posix-path.ts";
import { PromiseRuleDeadline } from "./rule-deadline.ts";
import { NodeRuleDirectoryReader } from "./rule-directory-reader.ts";
import { FileRuleModuleImporter } from "./rule-module-importer.ts";
import { NodeTrustStorage } from "./trust-storage.ts";

export interface CreateRuleCatalogOptions {
    /** The OpenCode config directory (`~/.config/opencode`). */
    readonly configDir: string;
    readonly reporter?: RuleLoadReporter;
    readonly disabledRules?: readonly string[];
    /** `false` drops every custom rule (project and global). Defaults to true. */
    readonly customRules?: boolean;
    /** A shared trust store; defaults to one over the config file. */
    readonly trust?: TrustStore;
    readonly builtins?: () => readonly Rule[];
    readonly deadline?: RuleDeadline;
    readonly timeoutMs?: number;
    readonly maxCachedDirectories?: number;
    readonly maxReported?: number;
}

/** The trust file inside the OpenCode config directory. */
export function trustFilePath(configDir: string): string {
    return join(configDir, "bashlight", "trusted.json");
}

/** Builds a mutable trust store over the config file (for the CLI commands). */
export function createTrustStore(configDir: string): JsonTrustStore {
    return new JsonTrustStore(new NodeTrustStorage(trustFilePath(configDir)));
}

export function createRuleCatalog(options: CreateRuleCatalogOptions): RuleCatalog {
    return new RuleCatalog({
        directories: new RuleDirectories(options.configDir),
        trust: options.trust ?? createTrustStore(options.configDir),
        reader: new NodeRuleDirectoryReader(),
        loader: new RuleModuleLoader({
            importer: new FileRuleModuleImporter(),
            helpers: createRuleHelpers(),
            ...(options.deadline === undefined
                ? { deadline: new PromiseRuleDeadline() }
                : { deadline: options.deadline }),
            ...(options.timeoutMs === undefined
                ? {}
                : { timeoutMs: options.timeoutMs }),
        }),
        ...(options.reporter === undefined ? {} : { reporter: options.reporter }),
        ...(options.disabledRules === undefined
            ? {}
            : { disabledRules: options.disabledRules }),
        ...(options.customRules === undefined
            ? {}
            : { customRules: options.customRules }),
        ...(options.builtins === undefined ? {} : { builtins: options.builtins }),
        ...(options.maxCachedDirectories === undefined
            ? {}
            : { maxCachedDirectories: options.maxCachedDirectories }),
        ...(options.maxReported === undefined
            ? {}
            : { maxReported: options.maxReported }),
    });
}
