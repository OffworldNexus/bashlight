/**
 * The set of rules in effect, assembled from custom files and the built-ins.
 *
 * Custom rules run first, then the built-ins; a custom rule whose id matches a
 * built-in replaces it. `disabledRules` removes both. Loading is cached per
 * file path and modification time, so re-scanning on every command is cheap and
 * editing a rule takes effect on the next command without restarting OpenCode.
 *
 * Loading is asynchronous (the runtime's `import` is), but `rulesFor` must be
 * synchronous (the processor is): `prepare(directory)` loads, `rulesFor` and
 * `report` read the last prepared snapshot. An unprepared directory falls back
 * to the built-ins, so a failure to load never breaks a command.
 */

import { createBuiltinRules } from "../builtin/index.ts";
import type { Rule } from "../rule.ts";
import type { RuleDirectories, RuleOrigin } from "./directories.ts";
import type { LoadedRuleModule, RuleModuleLoader } from "./module-loader.ts";
import type { RuleDirectoryReader, RuleFile } from "./reader.ts";

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

/** The full picture of a project's rules, including what failed to load. */
export interface CatalogReport {
    readonly rules: readonly CatalogRule[];
    readonly errors: readonly RuleLoadError[];
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
 * `prepare` is async; `rulesFor` and `report` are synchronous reads.
 */
export interface RuleAccess {
    prepare(directory: string): Promise<void>;
    rulesFor(directory: string): readonly Rule[];
    report(directory: string): CatalogReport;
}

export interface RuleCatalogOptions {
    readonly directories: RuleDirectories;
    readonly reader: RuleDirectoryReader;
    readonly loader: RuleModuleLoader;
    readonly reporter?: RuleLoadReporter;
    readonly disabledRules?: readonly string[];
    /** The fallback set; defaults to the built-ins. */
    readonly builtins?: () => readonly Rule[];
}

interface CacheEntry {
    readonly mtime: number;
    readonly loaded: LoadedRuleModule;
}

/** One rule file and the directory it was found in. */
interface ScannedFile {
    readonly file: RuleFile;
    readonly source: RuleOrigin;
}

export class RuleCatalog implements RuleAccess {
    private readonly cache = new Map<string, CacheEntry>();
    private readonly reports = new Map<string, CatalogReport>();
    private readonly reported = new Set<string>();
    private readonly disabled: ReadonlySet<string>;
    private readonly builtins: () => readonly Rule[];
    private readonly reporter: RuleLoadReporter;

    constructor(private readonly options: RuleCatalogOptions) {
        this.disabled = new Set(options.disabledRules ?? []);
        this.builtins = options.builtins ?? createBuiltinRules;
        this.reporter = options.reporter ?? new NoopRuleLoadReporter();
    }

    /** Re-scans the rule directories and loads any changed file. */
    async prepare(directory: string): Promise<void> {
        const found = this.scan(directory);
        for (const { file } of found) {
            const cached = this.cache.get(file.path);
            if (cached !== undefined && cached.mtime === file.mtime) {
                continue;
            }
            const loaded = await this.options.loader.load(file.path, file.mtime);
            this.cache.set(file.path, { mtime: file.mtime, loaded });
            if (!loaded.ok) {
                this.reportLoadError(file.path, file.mtime, loaded.message);
            }
        }
        this.reports.set(directory, this.build(found));
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

    /** Every custom file, in priority order, with the directory it came from. */
    private scan(directory: string): readonly ScannedFile[] {
        const found: ScannedFile[] = [];
        for (const ruleDirectory of this.options.directories.all(directory)) {
            for (const file of this.options.reader.entries(ruleDirectory.path)) {
                found.push({ file, source: ruleDirectory.origin });
            }
        }
        return found;
    }

    /** Assembles the report: custom rules first, then the unshadowed built-ins. */
    private build(found: readonly ScannedFile[]): CatalogReport {
        const rules: CatalogRule[] = [];
        const errors: RuleLoadError[] = [];
        const seen = new Set<string>();
        for (const { file, source } of found) {
            const cached = this.cache.get(file.path);
            if (cached === undefined) {
                continue;
            }
            if (!cached.loaded.ok) {
                errors.push({ path: file.path, message: cached.loaded.message });
                continue;
            }
            for (const rule of cached.loaded.rules) {
                if (seen.has(rule.id)) {
                    continue;
                }
                seen.add(rule.id);
                rules.push(this.entry(rule.id, source, file.path, rule));
            }
        }
        for (const rule of this.builtins()) {
            if (seen.has(rule.id)) {
                continue;
            }
            seen.add(rule.id);
            rules.push(this.entry(rule.id, "builtin", undefined, rule));
        }
        return { rules, errors };
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

    /** The built-ins alone, when nothing has been prepared for a directory. */
    private builtinReport(): CatalogReport {
        return {
            rules: this.builtins().map((rule) =>
                this.entry(rule.id, "builtin", undefined, rule),
            ),
            errors: [],
        };
    }

    private reportLoadError(path: string, mtime: number, message: string): void {
        const key = `${path}@${String(mtime)}`;
        if (this.reported.has(key)) {
            return;
        }
        this.reported.add(key);
        this.reporter.error(`could not load the custom rule ${path}: ${message}`);
    }
}
