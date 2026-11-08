/**
 * One place that knows where the private command corpus lives and whether it is
 * usable.
 *
 * The corpus is the `bashlight-corpus` git submodule mounted at `corpus/`; it
 * is not checked out on CI, and its contents are anonymized best-effort only,
 * so nothing from it may be copied into this repository. Corpus tests therefore
 * must degrade to a single, clearly labelled skip when the submodule is absent
 * (`describeCorpus`), and must never read the files at import time: every loader
 * here is called lazily from inside a test.
 *
 * `BASHLIGHT_CORPUS_DIR` overrides the corpus directory (used to simulate an
 * absent corpus), `BASHLIGHT_SKIP_CORPUS=1` forces the skip.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "bun:test";

import { isRecord } from "../../src/shared/guards.ts";

/** The default corpus location: the submodule at the repository root. */
const DEFAULT_CORPUS_DIR = fileURLToPath(new URL("../../corpus", import.meta.url));

/** Shown when the private submodule is simply not checked out. */
export const CORPUS_MISSING_MESSAGE =
    "corpus submodule not checked out — run " +
    "`git submodule update --init corpus` (private)";

/** The env var that turns every corpus test into a skip. */
export const CORPUS_SKIP_ENV = "BASHLIGHT_SKIP_CORPUS";

/** The env var that relocates the corpus (tests use it to fake absence). */
export const CORPUS_DIR_ENV = "BASHLIGHT_CORPUS_DIR";

/** One command line recorded in the corpus, with where it ran. */
export interface CorpusCommand {
    readonly id: string;
    readonly command: string;
    readonly cwd: string;
}

/** True when the corpus tests must be skipped regardless of availability. */
export function isCorpusSkipped(): boolean {
    return process.env[CORPUS_SKIP_ENV] === "1";
}

/** The corpus directory, honouring `BASHLIGHT_CORPUS_DIR`. */
export function corpusDir(): string {
    const override = process.env[CORPUS_DIR_ENV];
    return override === undefined || override === "" ? DEFAULT_CORPUS_DIR : override;
}

/** Absolute path of a file inside the corpus directory. */
export function corpusPath(name: string): string {
    return join(corpusDir(), name);
}

/** Whether the corpus data files exist (ignores `BASHLIGHT_SKIP_CORPUS`). */
export function isCorpusAvailable(): boolean {
    return (
        existsSync(corpusPath("commands.jsonl")) &&
        existsSync(corpusPath("projects.json"))
    );
}

/**
 * Runs `body` as a `describe` only when the corpus is present and not skipped;
 * otherwise registers one skipped test carrying the reason. The body is not
 * executed, so it may safely read corpus files.
 */
export function describeCorpus(name: string, body: () => void): void {
    if (isCorpusSkipped()) {
        skipCorpusTest(`corpus tests skipped (${CORPUS_SKIP_ENV}=1)`);
        return;
    }
    if (!isCorpusAvailable()) {
        skipCorpusTest(CORPUS_MISSING_MESSAGE);
        return;
    }
    describe(name, body);
}

function skipCorpusTest(reason: string): void {
    test.skip(reason, () => {
        // The callback never runs (the test is skipped); the assertion documents
        // that a skip always carries a reason and satisfies the lint rule.
        expect(reason.length).toBeGreaterThan(0);
    });
}

/**
 * Parses `corpus/commands.jsonl`. Malformed lines and records without a command
 * string are skipped; the result is typed through guards rather than cast.
 */
export function loadCorpusCommands(): CorpusCommand[] {
    const commands: CorpusCommand[] = [];
    for (const line of readCorpusLines("commands.jsonl")) {
        const record = parseLine(line);
        if (typeof record["command"] !== "string") {
            continue;
        }
        commands.push({
            id: typeof record["id"] === "string" ? record["id"] : "?",
            command: record["command"],
            cwd: typeof record["cwd"] === "string" ? record["cwd"] : "/",
        });
    }
    return commands;
}

function readCorpusLines(name: string): string[] {
    const path = corpusPath(name);
    let text: string;
    try {
        text = readFileSync(path, "utf8");
    } catch {
        throw new Error(`${CORPUS_MISSING_MESSAGE} (cannot read ${path})`);
    }
    return text.split("\n").filter((line) => line.trim() !== "");
}

/** The parsed JSON object, or an empty record when the line is malformed. */
function parseLine(line: string): Readonly<Record<string, unknown>> {
    try {
        const parsed: unknown = JSON.parse(line);
        return isRecord(parsed) ? parsed : {};
    } catch {
        return {};
    }
}
