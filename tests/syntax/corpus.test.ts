/**
 * Corpus test: parse every real command and assert the parse success rate and
 * the span round-trip invariants. Skipped with a clear message when the private
 * corpus submodule is absent (see `tests/support/corpus.ts`).
 */

import { expect, test } from "bun:test";

import { Parser } from "../../src/syntax/parser.ts";
import { createSourceDocument } from "../../src/syntax/source.ts";
import { describeCorpus, loadCorpusCommands } from "../support/corpus.ts";
import { checkSpans } from "./helpers.ts";

const MIN_SUCCESS_RATE = 0.99;

describeCorpus("corpus", () => {
    test("parses almost every command with exact spans", () => {
        const corpus = loadCorpusCommands();
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
