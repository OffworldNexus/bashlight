/**
 * The set of rules in effect, assembled from custom files and the built-ins.
 *
 * Custom rules run first, then the built-ins; a custom rule whose id matches a
 * built-in replaces it. `disabledRules` removes both, and `customRules: false`
 * removes every custom rule (project and global).
 *
 * Project rule files are only loaded when their directory is trusted (see
 * {@link TrustStore}); global rules are always trusted. Loading is cached per
 * rule directory and keyed on the directory's file list (path, mtime, size), so
 * re-scanning on every command is cheap. When any file in a directory changes,
 * appears or disappears, the whole directory reloads and its module subtree is
 * evicted from the runtime cache, so a helper imported by a rule is reloaded
 * too. Imports from outside the rules directory are not reloaded until OpenCode
 * restarts.
 *
 * Loading is asynchronous (the runtime's `import` is), but `rulesFor` must be
 * synchronous (the processor is): `refresh(directory)` loads, `rulesFor` and
 * `report` read the last refreshed snapshot. An unprepared directory falls back
 * to the built-ins, so a failure to load never breaks a command.
 */

import { BoundedSet, LruMap } from "../../shared/bounded.ts";
import { createBuiltinRules } from "../builtin/index.ts";
import type { Rule } from "../rule.ts";
import type { RuleDirectories, RuleOrigin } from "./directories.ts";
import type { RuleModuleLoader } from "./module-loader.ts";
import type { RuleDirectoryReader, RuleFile } from "./reader.ts";
import type { TrustStore } from "./trust.ts";

/** Where a rule came from, for `bashlight rules` and `doctor`. */
export type RuleSource = "builtin" | RuleOrigin;

/** One active or disabled rule, with its provenance. */
export interface CatalogRule {
    readonly id: string;
    readonly source: RuleSource;
    /** The file it came from, for custom rules. */
    readonly path?: string;
    readonly disabled: boolean;
    readonly rule: Rule;
}

/** A rule file that could not be loaded. */
export interface RuleLoadError {
    readonly path: string;
    readonly message: string;
}

/** Project rule files that were found but skipped because the project is untrusted. */
export interface UntrustedRules {
    /** The project directory `bashlight trust` expects. */
    readonly directory: string;
    readonly files: number;
}

/** The full picture of a project's rules, including what failed to load. */
export interface CatalogReport {
    readonly rules: readonly CatalogRule[];
    readonly errors: readonly RuleLoadError[];
    /** False when the `customRules` option disabled every custom rule. */
    readonly customRulesEnabled: boolean;
    /** Present when project rule files exist but the project is not trusted. */
    readonly untrusted?: UntrustedRules;
}

/** Where a catalog reports load failures (fail-open: logging never breaks). */
export interface RuleLoadReporter {
    error(message: string, cause?: unknown): void;
}

/** Discards load failures; used where an operator is not watching. */
export class NoopRuleLoadReporter implements RuleLoadReporter {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- intentionally empty
    error(_message: string, _cause?: unknown): void {
        // Intentionally empty.
    }
}

/**
 * The rule access the processor, `explain`, `rules` and `doctor` share.
 * `refresh` is async; `rulesFor` and `report` are synchronous reads.
 */
export interface RuleAccess {
    refresh(directory: string): Promise<void>;
    rulesFor(directory: string): readonly Rule[];
    report(directory: string): CatalogReport;
}

export interface RuleCatalogOptions {
    readonly directories: RuleDirectories;
    readonly reader: RuleDirectoryReader;
    readonly loader: RuleModuleLoader;
    readonly trust: TrustStore;
    readonly reporter?: RuleLoadReporter;
    readonly disabledRules?: readonly string[];
    /** Defaults to true; `false` drops every custom rule. */
    readonly customRules?: boolean;
    /** The fallback set; defaults to the built-ins. */
    readonly builtins?: () => readonly Rule[];
    /** How many rule directories to keep loaded. Defaults to 64. */
    readonly maxCachedDirectories?: number;
    /** How many "already reported" keys to remember. Defaults to 512. */
    readonly maxReported?: number;
}

const DEFAULT_MAX_DIRECTORIES = 64;
const DEFAULT_MAX_REPORTED = 512;

/** One rule and the file it was defined in. */
interface LoadedRule {
    readonly rule: Rule;
    readonly path: string;
}

/** Everything loaded from one rule directory for one file-list signature. */
interface DirectoryLoad {
    readonly signature: string;
    readonly rules: readonly LoadedRule[];
    readonly errors: readonly RuleLoadError[];
}

/** One rule directory and what (if anything) was loaded from it. */
interface DirectoryEntry {
    readonly origin: RuleOrigin;
    readonly load: DirectoryLoad | undefined;
}

export class RuleCatalog implements RuleAccess {
    private readonly loads: LruMap<string, DirectoryLoad>;
    private readonly reports: LruMap<string, CatalogReport>;
    private readonly reported: BoundedSet<string>;
    private readonly inFlight = new Map<string, Promise<void>>();
    private readonly disabled: ReadonlySet<string>;
    private readonly customRules: boolean;
    private readonly builtins: () => readonly Rule[];
    private readonly reporter: RuleLoadReporter;

    constructor(private readonly options: RuleCatalogOptions) {
        this.disabled = new Set(options.disabledRules ?? []);
        this.customRules = options.customRules ?? true;
        this.builtins = options.builtins ?? createBuiltinRules;
        this.reporter = options.reporter ?? new NoopRuleLoadReporter();
        this.loads = new LruMap(
            options.maxCachedDirectories ?? DEFAULT_MAX_DIRECTORIES,
        );
        this.reports = new LruMap(
            options.maxCachedDirectories ?? DEFAULT_MAX_DIRECTORIES,
        );
        this.reported = new BoundedSet(options.maxReported ?? DEFAULT_MAX_REPORTED);
    }

    /** Re-scans the rule directories and reloads any that changed. */
    refresh(directory: string): Promise<void> {
        const existing = this.inFlight.get(directory);
        if (existing !== undefined) {
            return existing;
        }
        const promise = this.doRefresh(directory).finally(() => {
            this.inFlight.delete(directory);
        });
        this.inFlight.set(directory, promise);
        return promise;
    }

    rulesFor(directory: string): readonly Rule[] {
        const report = this.reports.get(directory) ?? this.builtinReport();
        return report.rules
            .filter((entry) => !entry.disabled)
            .map((entry) => entry.rule);
    }

    report(directory: string): CatalogReport {
        return this.reports.get(directory) ?? this.builtinReport();
    }

    private async doRefresh(directory: string): Promise<void> {
        try {
            const report = await this.scan(directory);
            this.reports.set(directory, report);
        } catch (error) {
            this.reporter.error(`could not scan the rules for ${directory}`, error);
            this.reports.set(directory, this.builtinReport());
        }
    }

    private async scan(directory: string): Promise<CatalogReport> {
        const project = this.options.directories.project(directory);
        const global = this.options.directories.global();
        const trusted = this.options.trust.isTrusted(directory);
        const untrusted: UntrustedRules | undefined =
            this.customRules && !trusted
                ? { directory, files: this.options.reader.entries(project.path).length }
                : undefined;
        if (untrusted !== undefined && untrusted.files > 0) {
            this.reportUntrusted(untrusted);
        }
        const loaded: DirectoryEntry[] = [];
        if (this.customRules) {
            loaded.push({
                origin: "project",
                load: trusted ? await this.loadDirectory(project.path) : undefined,
            });
            loaded.push({
                origin: "global",
                load: await this.loadDirectory(global.path),
            });
        }
        return this.build(loaded, untrusted);
    }

    /** Loads one rule directory, reusing the cache when its file list is unchanged. */
    private async loadDirectory(path: string): Promise<DirectoryLoad> {
        const files = this.options.reader.entries(path);
        const signature = signatureOf(files);
        const cached = this.loads.get(path);
        if (cached !== undefined && cached.signature === signature) {
            return cached;
        }
        this.options.loader.evict(path);
        const rules: LoadedRule[] = [];
        const errors: RuleLoadError[] = [];
        for (const file of files) {
            const loaded = await this.options.loader.load(file.path, signature);
            if (loaded.ok) {
                rules.push(...loaded.rules.map((rule) => ({ rule, path: file.path })));
            } else {
                errors.push({ path: file.path, message: loaded.message });
                this.reportLoadError(file, loaded.message);
            }
        }
        const load: DirectoryLoad = { signature, rules, errors };
        this.loads.set(path, load);
        return load;
    }

    /** Assembles the report: custom rules first, then the unshadowed built-ins. */
    private build(
        loaded: readonly DirectoryEntry[],
        untrusted: UntrustedRules | undefined,
    ): CatalogReport {
        const rules: CatalogRule[] = [];
        const errors: RuleLoadError[] = [];
        const seen = new Set<string>();
        for (const { origin, load } of loaded) {
            if (load === undefined) {
                continue;
            }
            errors.push(...load.errors);
            for (const { rule, path } of load.rules) {
                if (seen.has(rule.id)) {
                    continue;
                }
                seen.add(rule.id);
                rules.push(this.entry(rule.id, origin, path, rule));
            }
        }
        this.appendBuiltins(rules, seen);
        return {
            rules,
            errors,
            customRulesEnabled: this.customRules,
            ...(untrusted === undefined ? {} : { untrusted }),
        };
    }

    /** The built-ins alone, when nothing has been refreshed for a directory. */
    private builtinReport(): CatalogReport {
        const rules: CatalogRule[] = [];
        this.appendBuiltins(rules, new Set());
        return { rules, errors: [], customRulesEnabled: this.customRules };
    }

    /** Appends the built-ins that no custom rule already shadows. */
    private appendBuiltins(rules: CatalogRule[], seen: Set<string>): void {
        for (const rule of this.builtins()) {
            if (seen.has(rule.id)) {
                continue;
            }
            seen.add(rule.id);
            rules.push(this.entry(rule.id, "builtin", undefined, rule));
        }
    }

    private entry(
        id: string,
        source: RuleSource,
        path: string | undefined,
        rule: Rule,
    ): CatalogRule {
        return {
            id,
            source,
            disabled: this.disabled.has(id),
            rule,
            ...(path === undefined ? {} : { path }),
        };
    }

    /** Logs the untrusted-project notice once per project directory. */
    private reportUntrusted(untrusted: UntrustedRules): void {
        const key = `untrusted:${untrusted.directory}`;
        if (this.reported.has(key)) {
            return;
        }
        this.reported.add(key);
        this.reporter.error(
            `${String(untrusted.files)} project rule file(s) are not trusted; run 'bashlight trust ${untrusted.directory}' to enable them`,
        );
    }

    private reportLoadError(file: RuleFile, message: string): void {
        const key = `${file.path}@${String(file.mtime)}:${String(file.size)}`;
        if (this.reported.has(key)) {
            return;
        }
        this.reported.add(key);
        this.reporter.error(`could not load the custom rule ${file.path}: ${message}`);
    }
}

/**
 * A stable identity for a directory's file list. Any change to a path, mtime or
 * size (including a file appearing or disappearing) yields a new signature.
 */
function signatureOf(files: readonly RuleFile[]): string {
    return files
        .map((file) => `${file.path}@${String(file.mtime)}:${String(file.size)}`)
        .join("\n");
}
