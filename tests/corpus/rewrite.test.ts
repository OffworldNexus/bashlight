/* eslint-disable sonarjs/cognitive-complexity */
/**
 * Corpus rewrite test: run every anonymized real command through the full
 * pipeline over a filesystem built from `corpus/projects.json`.
 *
 * Asserts zero crashes, that every rewrite re-parses, and that the validator
 * never rejects a plan (a validation failure would reveal a rewriter bug).
 * Regenerates `corpus/expected-rewrites.jsonl` with `BASHLIGHT_UPDATE_GOLDEN=1`
 * and otherwise diffs against it.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "bun:test";

import { createBashlight } from "../../src/bashlight.ts";
import { createSourceDocument, Parser } from "../../src/syntax/index.ts";
import { CorpusFixture, loadCommands } from "./fixture.ts";

const GOLDEN_PATH = fileURLToPath(
    new URL("../../corpus/expected-rewrites.jsonl", import.meta.url),
);

const ENV = { HOME: "/home/user", PATH: "/usr/bin:/bin" };

interface GoldenRecord {
    readonly id: string;
    readonly before: string;
    readonly after?: string;
    readonly blocked?: string;
    readonly rules: readonly string[];
}

interface CorpusRun {
    readonly records: GoldenRecord[];
    readonly commands: number;
    readonly rewritten: number;
    readonly blocked: number;
    readonly validationFailures: number;
    readonly internalErrors: number;
    readonly thrown: { id: string; message: string }[];
    readonly unparseableRewrites: string[];
    readonly ruleCounts: ReadonlyMap<string, number>;
    readonly giveUpReasons: ReadonlyMap<string, number>;
}

function runCorpus(): CorpusRun {
    const commands = loadCommands();
    const processor = createBashlight({ fileSystem: new CorpusFixture().fileSystem() });
    const parser = new Parser();
    const records: GoldenRecord[] = [];
    const thrown: { id: string; message: string }[] = [];
    const unparseableRewrites: string[] = [];
    const ruleCounts = new Map<string, number>();
    const giveUpReasons = new Map<string, number>();
    let rewritten = 0;
    let blocked = 0;
    let validationFailures = 0;
    let internalErrors = 0;

    for (const record of commands) {
        let outcome;
        try {
            outcome = processor.process({
                command: record.command,
                cwd: record.cwd,
                env: ENV,
            });
        } catch (error) {
            thrown.push({
                id: record.id,
                message: error instanceof Error ? error.message : String(error),
            });
            continue;
        }
        if (outcome.kind === "rewritten") {
            rewritten += 1;
            const ids = outcome.changes.flatMap((change) => change.ruleIds);
            for (const id of ids) {
                ruleCounts.set(id, (ruleCounts.get(id) ?? 0) + 1);
            }
            if (!parser.parse(createSourceDocument(outcome.command)).ok) {
                unparseableRewrites.push(record.id);
            }
            records.push({
                id: record.id,
                before: record.command,
                after: outcome.command,
                rules: [...new Set(ids)],
            });
        } else if (outcome.kind === "blocked") {
            blocked += 1;
            for (const id of outcome.ruleIds) {
                ruleCounts.set(id, (ruleCounts.get(id) ?? 0) + 1);
            }
            records.push({
                id: record.id,
                before: record.command,
                blocked: outcome.message,
                rules: [...new Set(outcome.ruleIds)],
            });
        } else {
            const reason = outcome.reason ?? "";
            if (reason.startsWith("validation failed")) {
                validationFailures += 1;
            } else if (reason.startsWith("internal error")) {
                internalErrors += 1;
            } else if (reason !== "") {
                giveUpReasons.set(reason, (giveUpReasons.get(reason) ?? 0) + 1);
            }
        }
    }
    return {
        records,
        commands: commands.length,
        rewritten,
        blocked,
        validationFailures,
        internalErrors,
        thrown,
        unparseableRewrites,
        ruleCounts,
        giveUpReasons,
    };
}

const run = runCorpus();

describe("corpus rewrite", () => {
    test("never crashes and keeps every rewrite valid", () => {
        console.log(
            `corpus rewrite: ${run.commands} commands, ${run.rewritten} rewritten, ` +
                `${run.blocked} blocked`,
        );
        console.log(
            `  rules: ${JSON.stringify([...run.ruleCounts].sort((a, b) => b[1] - a[1]))}`,
        );
        console.log(
            `  validation failures: ${run.validationFailures}, internal errors: ` +
                `${run.internalErrors}, unparseable rewrites: ${run.unparseableRewrites.length}`,
        );
        console.log(
            `  give-up reasons: ${JSON.stringify(
                [...run.giveUpReasons].sort((a, b) => b[1] - a[1]).slice(0, 20),
            )}`,
        );
        for (const failure of run.thrown.slice(0, 20)) {
            console.log(`  THREW ${failure.id}: ${failure.message}`);
        }
        expect(run.thrown).toEqual([]);
        expect(run.unparseableRewrites).toEqual([]);
        expect(run.validationFailures).toBe(0);
        expect(run.internalErrors).toBe(0);
    }, 120_000);

    test("matches the golden rewrite file", () => {
        expect(run.records.length).toBeGreaterThan(0);
        const serialized =
            run.records.map((record) => JSON.stringify(record)).join("\n") + "\n";
        const update = process.env["BASHLIGHT_UPDATE_GOLDEN"] === "1";
        if (update || !existsSync(GOLDEN_PATH)) {
            writeFileSync(GOLDEN_PATH, serialized);
            return;
        }
        const golden = readFileSync(GOLDEN_PATH, "utf8");
        if (golden === serialized) {
            return;
        }
        const expectedLines = golden.split("\n");
        const actualLines = serialized.split("\n");
        const length = Math.max(expectedLines.length, actualLines.length);
        for (let index = 0; index < length; index += 1) {
            if (expectedLines[index] !== actualLines[index]) {
                throw new Error(
                    `golden mismatch at line ${index + 1}:\n` +
                        `  expected ${expectedLines[index] ?? "<missing>"}\n` +
                        `  actual   ${actualLines[index] ?? "<missing>"}`,
                );
            }
        }
    }, 120_000);
});
