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
 * stay in the adapter layer. `load` never throws: a file that fails to import,
 * whose export is malformed or hostile, or that takes too long yields an error
 * value. The caller skips it and the command runs unchanged.
 */

import type { Rule } from "../rule.ts";
import type { RuleHelpers } from "./helpers.ts";

/**
 * The shape a rule file may export as its default. Type-only use is expected:
 * `import type { RuleFactory } from "bashlight"`.
 */
export type RuleFactory = (helpers: RuleHelpers) => Rule | readonly Rule[];
export type RuleModuleExport = Rule | RuleFactory | readonly (Rule | RuleFactory)[];

/** Imports a rule module and evicts a whole directory from the runtime cache. */
export interface RuleModuleImporter {
    /** Imports `path`; `signature` busts the runtime's module cache. */
    import(path: string, signature: string): Promise<unknown>;
    /** Drops `directory` and everything under it from the runtime cache. */
    evict(directory: string): void;
}

/**
 * Bounds how long an import plus factory evaluation may take. Injected so the
 * loader stays free of timers and the tests can drive it deterministically.
 */
export interface RuleDeadline {
    /** Resolves/rejects with `work`, or rejects once `milliseconds` pass. */
    limit<T>(work: Promise<T>, milliseconds: number): Promise<T>;
}

/** Raised by a {@link RuleDeadline} when `work` outlives its budget. */
export class RuleDeadlineError extends Error {
    override readonly name = "RuleDeadlineError";
}

/** No budget: `work` always wins. The default for tests and pure callers. */
export class NoDeadline implements RuleDeadline {
    limit<T>(work: Promise<T>): Promise<T> {
        return work;
    }
}

export type LoadedRuleModule =
    | { readonly ok: true; readonly rules: readonly Rule[] }
    | { readonly ok: false; readonly message: string };

export interface RuleModuleLoaderOptions {
    readonly importer: RuleModuleImporter;
    readonly helpers: RuleHelpers;
    /** Defaults to {@link NoDeadline}; the composition roots inject a real one. */
    readonly deadline?: RuleDeadline;
    /** Budget for import + factories, in milliseconds. Defaults to 2000. */
    readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 2000;
const NO_DEADLINE = new NoDeadline();

export class RuleModuleLoader {
    constructor(private readonly options: RuleModuleLoaderOptions) {}

    /** Imports `path` and builds its rules; never throws. */
    async load(path: string, signature: string): Promise<LoadedRuleModule> {
        const deadline = this.options.deadline ?? NO_DEADLINE;
        const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        try {
            return await deadline.limit(this.evaluate(path, signature), timeoutMs);
        } catch (error) {
            return {
                ok: false,
                message:
                    error instanceof RuleDeadlineError
                        ? `timed out after ${String(timeoutMs)}ms (imports and factories must be fast)`
                        : messageOf(error),
            };
        }
    }

    /** Drops a rule directory from the runtime's module cache. */
    evict(directory: string): void {
        this.options.importer.evict(directory);
    }

    /** The whole body, guarded: any failure becomes a `{ ok: false }`. */
    private async evaluate(path: string, signature: string): Promise<LoadedRuleModule> {
        let module: unknown;
        try {
            module = await this.options.importer.import(path, signature);
        } catch (error) {
            return { ok: false, message: `could not import: ${messageOf(error)}` };
        }
        try {
            const exported = defaultExport(module);
            if (exported === undefined) {
                return { ok: false, message: "module has no default export" };
            }
            const rules: Rule[] = [];
            const error = collect(exported, this.options.helpers, rules, new Set());
            return error === undefined
                ? { ok: true, rules }
                : { ok: false, message: error };
        } catch (error) {
            return {
                ok: false,
                message: `could not inspect the export: ${messageOf(error)}`,
            };
        }
    }
}

/** The `default` export of a module namespace, or `undefined`. */
function defaultExport(module: unknown): unknown {
    return typeof module === "object" && module !== null && "default" in module
        ? module.default
        : undefined;
}

/**
 * Flattens export shapes into `rules`, returning an error message on a dud.
 * Only arrays are tracked for cycles: a rule is a leaf, and a factory that
 * returns itself is caught by the outer guard.
 */
function collect(
    value: unknown,
    helpers: RuleHelpers,
    rules: Rule[],
    seen: Set<unknown>,
): string | undefined {
    if (Array.isArray(value)) {
        if (seen.has(value)) {
            return "the default export contains a cycle";
        }
        seen.add(value);
        for (const item of value) {
            const error = collect(item, helpers, rules, seen);
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
        return collect(produced, helpers, rules, seen);
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
