/* eslint-disable sonarjs/function-return-type -- an error message or `undefined` */
/**
 * Loading and validating one custom rule module.
 *
 * The default export of a rule file is one of:
 *   - a `Rule` object;
 *   - a factory `(helpers) => Rule | Rule[]`;
 *   - an array of either.
 *
 * The importer is injected so the cache-busting and the runtime's module cache
 * stay in the adapter layer. A file that fails to import or whose export is
 * malformed yields an error value (never a throw): the caller skips it and the
 * command runs unchanged.
 */

import type { Rule } from "../rule.ts";
import type { RuleHelpers } from "./helpers.ts";

/**
 * The shape a rule file may export as its default. Type-only use is expected:
 * `import type { RuleFactory } from "bashlight"`.
 */
export type RuleFactory = (helpers: RuleHelpers) => Rule | readonly Rule[];
export type RuleModuleExport = Rule | RuleFactory | readonly (Rule | RuleFactory)[];

/** Imports a rule module. `version` busts the runtime's module cache. */
export interface RuleModuleImporter {
    import(path: string, version: number): Promise<unknown>;
}

export type LoadedRuleModule =
    | { readonly ok: true; readonly rules: readonly Rule[] }
    | { readonly ok: false; readonly message: string };

export interface RuleModuleLoaderOptions {
    readonly importer: RuleModuleImporter;
    readonly helpers: RuleHelpers;
}

export class RuleModuleLoader {
    constructor(private readonly options: RuleModuleLoaderOptions) {}

    /** Imports `path` and builds its rules; never throws. */
    async load(path: string, version: number): Promise<LoadedRuleModule> {
        let module: unknown;
        try {
            module = await this.options.importer.import(path, version);
        } catch (error) {
            return { ok: false, message: `could not import: ${messageOf(error)}` };
        }
        const exported = defaultExport(module);
        if (exported === undefined) {
            return { ok: false, message: "module has no default export" };
        }
        const rules: Rule[] = [];
        const error = collect(exported, this.options.helpers, rules);
        return error === undefined
            ? { ok: true, rules }
            : { ok: false, message: error };
    }
}

/** The `default` export of a module namespace, or `undefined`. */
function defaultExport(module: unknown): unknown {
    return typeof module === "object" && module !== null && "default" in module
        ? module.default
        : undefined;
}

/** Flattens export shapes into `rules`, returning an error message on a dud. */
function collect(
    value: unknown,
    helpers: RuleHelpers,
    rules: Rule[],
): string | undefined {
    if (Array.isArray(value)) {
        for (const item of value) {
            const error = collect(item, helpers, rules);
            if (error !== undefined) {
                return error;
            }
        }
        return undefined;
    }
    if (isRule(value)) {
        rules.push(value);
        return undefined;
    }
    if (typeof value === "function") {
        let produced: unknown;
        try {
            produced = (value as RuleFactory)(helpers);
        } catch (error) {
            return `rule factory threw: ${messageOf(error)}`;
        }
        return collect(produced, helpers, rules);
    }
    return "default export is not a rule or a rule factory";
}

/** Whether `value` looks like a `Rule` (a stable id, a scope, an `inspect`). */
export function isRule(value: unknown): value is Rule {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    const scope = candidate["scope"];
    return (
        typeof candidate["id"] === "string" &&
        (scope === "local" || scope === "any") &&
        typeof candidate["inspect"] === "function"
    );
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
