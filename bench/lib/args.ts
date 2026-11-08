/* eslint-disable sonarjs/function-return-type -- ParseResult is a discriminated union */
/**
 * Command line parsing for `bun bench/run.ts`.
 *
 * Kept pure and separate from the runner so the option handling (and the
 * errors it emits) can be tested without spawning anything.
 */

import type { Mode } from "./types.ts";

export interface RunOptions {
    readonly models: readonly string[];
    readonly modes: readonly Mode[];
    readonly projects: readonly string[];
    readonly repeat: number;
    readonly dryRun: boolean;
    readonly maxCostUsd: number;
    readonly timeoutMs: number;
}

export interface RunDefaults {
    readonly models: readonly string[];
    readonly projects: readonly string[];
}

export type ParseResult =
    | { readonly ok: true; readonly options: RunOptions }
    | { readonly ok: false; readonly error: string };

/** The mutable accumulator the flag handlers write into. */
interface Draft {
    models: string[];
    modes: Mode[];
    projects: string[];
    repeat: number;
    dryRun: boolean;
    maxCostUsd: number;
    timeoutMs: number;
}

function splitList(value: string): string[] {
    return value
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item !== "");
}

function isMode(value: string): value is Mode {
    return value === "with" || value === "without";
}

/** Applies one flag to the draft, returning an error message or `undefined`. */
function applyFlag(
    draft: Draft,
    flag: string,
    value: string | undefined,
): string | undefined {
    switch (flag) {
        case "--models":
            if (value === undefined) {
                return "--models needs a value";
            }
            draft.models = splitList(value);
            return undefined;
        case "--projects":
            if (value === undefined) {
                return "--projects needs a value";
            }
            draft.projects = splitList(value);
            return undefined;
        case "--modes": {
            if (value === undefined) {
                return "--modes needs a value";
            }
            const parsed = splitList(value);
            if (!parsed.every(isMode)) {
                return "--modes must be with and/or without";
            }
            draft.modes = parsed;
            return undefined;
        }
        case "--repeat": {
            const parsed = Number(value);
            if (!Number.isInteger(parsed) || parsed < 1) {
                return "--repeat must be a positive integer";
            }
            draft.repeat = parsed;
            return undefined;
        }
        case "--max-cost": {
            const parsed = Number(value);
            if (!Number.isFinite(parsed) || parsed < 0) {
                return "--max-cost must be a non-negative number";
            }
            draft.maxCostUsd = parsed;
            return undefined;
        }
        case "--timeout": {
            const parsed = Number(value);
            if (!Number.isFinite(parsed) || parsed <= 0) {
                return "--timeout must be a positive number of seconds";
            }
            draft.timeoutMs = parsed * 1000;
            return undefined;
        }
        default:
            return `unknown argument: ${flag}`;
    }
}

/** The next token when it is not another flag, advancing `index`. */
function takeValue(
    argv: readonly string[],
    index: number,
): { readonly value: string | undefined; readonly next: number } {
    const candidate = argv[index + 1];
    if (candidate === undefined || candidate.startsWith("--")) {
        return { value: undefined, next: index };
    }
    return { value: candidate, next: index + 1 };
}

/** Parses `argv` (without the runtime and script) into {@link RunOptions}. */
export function parseRunArgs(
    argv: readonly string[],
    defaults: RunDefaults,
): ParseResult {
    const draft: Draft = {
        models: [...defaults.models],
        modes: ["with", "without"],
        projects: [...defaults.projects],
        repeat: 1,
        dryRun: false,
        maxCostUsd: Number.POSITIVE_INFINITY,
        timeoutMs: 600_000,
    };
    let index = 0;
    while (index < argv.length) {
        const raw = argv[index];
        if (raw === undefined) {
            break;
        }
        const [flag = "", inline] = raw.split("=", 2);
        if (flag === "--dry-run") {
            draft.dryRun = true;
            index += 1;
            continue;
        }
        if (flag === "--help" || flag === "-h") {
            return { ok: false, error: "help" };
        }
        const inlineValue =
            inline !== undefined ? { value: inline, next: index } : undefined;
        const taken = inlineValue ?? takeValue(argv, index);
        index = taken.next + 1;
        const error = applyFlag(draft, flag, taken.value);
        if (error !== undefined) {
            return { ok: false, error };
        }
    }
    if (draft.models.length === 0) {
        return { ok: false, error: "at least one model is required" };
    }
    if (draft.projects.length === 0) {
        return { ok: false, error: "at least one project is required" };
    }
    if (draft.modes.length === 0) {
        return { ok: false, error: "at least one mode is required" };
    }
    return { ok: true, options: { ...draft } };
}

/** Human-readable usage for `--help` and parse errors. */
export const USAGE = [
    "Usage: bun bench/run.ts [options]",
    "",
    "  --models a,b,c        models to run (default: the cheap trio)",
    "  --modes with,without  plugin modes (default: with,without)",
    "  --projects all|a,b    projects (default: all)",
    "  --repeat N            repeats per cell (default: 1)",
    "  --max-cost N          stop before a run whose projection exceeds N USD",
    "  --timeout N           per-run timeout in seconds (default: 600)",
    "  --dry-run             print the matrix without running it",
    "",
].join("\n");
