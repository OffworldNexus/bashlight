/* eslint-disable sonarjs/cognitive-complexity */
/**
 * Corpus rewrite test: run every anonymized real command through the full
 * pipeline over a filesystem built from `corpus/projects.json`.
 *
 * Asserts zero crashes, that every rewrite re-parses, and that the validator
 * never rejects a plan (a validation failure would reveal a rewriter bug).
 * Regenerates `corpus/expected-rewrites.jsonl` with `BASHLIGHT_UPDATE_GOLDEN=1`
 * and otherwise diffs against it. Skipped when the private corpus checkout is
 * absent (see `tests/support/corpus.ts`).
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { expect, test } from "bun:test";

import { createBashlight } from "../../src/bashlight.ts";
import { createSourceDocument, Parser } from "../../src/syntax/index.ts";
import { corpusPath, describeCorpus, loadCorpusCommands } from "../support/corpus.ts";
import { CorpusFixture } from "./fixture.ts";

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
    const commands = loadCorpusCommands();
    const processor = createBashlight({
        fileSystem: new CorpusFixture().fileSystem(),
    });
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

describeCorpus("corpus rewrite", () => {
    // Memoized per file: the corpus is read on the first test, never at import.
    let run: CorpusRun | undefined;
    const corpusRun = (): CorpusRun => (run ??= runCorpus());

    test("never crashes and keeps every rewrite valid", () => {
        const result = corpusRun();
        console.log(
            `corpus rewrite: ${result.commands} commands, ${result.rewritten} ` +
                `rewritten, ${result.blocked} blocked`,
        );
        console.log(
            `  rules: ${JSON.stringify(
                [...result.ruleCounts].sort((a, b) => b[1] - a[1]),
            )}`,
        );
        console.log(
            `  validation failures: ${result.validationFailures}, internal errors: ` +
                `${result.internalErrors}, unparseable rewrites: ` +
                `${result.unparseableRewrites.length}`,
        );
        console.log(
            `  give-up reasons: ${JSON.stringify(
                [...result.giveUpReasons]
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 20),
            )}`,
        );
        for (const failure of result.thrown.slice(0, 20)) {
            console.log(`  THREW ${failure.id}: ${failure.message}`);
        }
        expect(result.thrown).toEqual([]);
        expect(result.unparseableRewrites).toEqual([]);
        expect(result.validationFailures).toBe(0);
        expect(result.internalErrors).toBe(0);
    }, 120_000);

    test("matches the golden rewrite file", () => {
        const result = corpusRun();
        expect(result.records.length).toBeGreaterThan(0);
        const goldenPath = corpusPath("expected-rewrites.jsonl");
        const serialized =
            result.records.map((record) => JSON.stringify(record)).join("\n") + "\n";
        const update = process.env["BASHLIGHT_UPDATE_GOLDEN"] === "1";
        if (update || !existsSync(goldenPath)) {
            writeFileSync(goldenPath, serialized);
            return;
        }
        const golden = readFileSync(goldenPath, "utf8");
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
