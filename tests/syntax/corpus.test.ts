// loadCorpus returns undefined when the corpus has not been generated.
/* eslint-disable sonarjs/function-return-type */
/**
 * Corpus test: parse every real command and assert the parse success rate and
 * the span round-trip invariants. Skipped with a clear message when the corpus
 * has not been generated yet (it is produced by another agent).
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "bun:test";

import { Parser } from "../../src/syntax/parser.ts";
import { createSourceDocument } from "../../src/syntax/source.ts";
import { checkSpans } from "./helpers.ts";

const CORPUS_PATH = fileURLToPath(
    new URL("../../corpus/commands.jsonl", import.meta.url),
);
const MIN_SUCCESS_RATE = 0.99;

interface CorpusRecord {
    readonly id: string;
    readonly command: string;
}

function loadCorpus(): CorpusRecord[] | undefined {
    if (!existsSync(CORPUS_PATH)) {
        return undefined;
    }
    const records: CorpusRecord[] = [];
    for (const line of readFileSync(CORPUS_PATH, "utf8").split("\n")) {
        if (line.trim().length === 0) {
            continue;
        }
        try {
            const parsed = JSON.parse(line) as { id?: unknown; command?: unknown };
            if (typeof parsed.command === "string") {
                records.push({
                    id: typeof parsed.id === "string" ? parsed.id : "?",
                    command: parsed.command,
                });
            }
        } catch {
            // ignore malformed lines
        }
    }
    return records;
}

const corpus = loadCorpus();

describe("corpus", () => {
    if (corpus === undefined) {
        test.skip("corpus/commands.jsonl is not available yet", () => {
            expect(corpus).toBeUndefined();
        });
        return;
    }

    test("parses almost every command with exact spans", () => {
        const parser = new Parser();
        let ok = 0;
        let spanViolations = 0;
        const failures: {
            id: string;
            command: string;
            message: string;
            span: unknown;
        }[] = [];
        for (const record of corpus) {
            const doc = createSourceDocument(record.command);
            const result = parser.parse(doc);
            if (!result.ok) {
                failures.push({
                    id: record.id,
                    command: record.command,
                    message: result.error.message,
                    span: result.error.span,
                });
                continue;
            }
            ok += 1;
            if (checkSpans(doc, result.script).length > 0) {
                spanViolations += 1;
            }
        }
        const rate = ok / corpus.length;
        console.log(
            `corpus: ${ok}/${corpus.length} parsed (${(rate * 100).toFixed(2)}%), ` +
                `span violations: ${spanViolations}, failures: ${failures.length}`,
        );
        for (const failure of failures.slice(0, 30)) {
            console.log(
                `  ${failure.id}: ${failure.message} @ ${JSON.stringify(failure.span)}\n` +
                    `    ${failure.command.slice(0, 200)}`,
            );
        }
        expect(spanViolations).toBe(0);
        expect(rate).toBeGreaterThanOrEqual(MIN_SUCCESS_RATE);
    }, 120_000);
});
