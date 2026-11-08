// The corpus test is a broad, data-driven check.
/* eslint-disable sonarjs/cognitive-complexity, sonarjs/function-return-type */
/**
 * Interpret every command of `corpus/commands.jsonl` with the cwd it ran in.
 * Asserts zero exceptions and no truncation (except on a short list of
 * pathological inputs), and prints the interpreter's coverage stats.
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "bun:test";

import { createInterpreter } from "../../src/interp/index.ts";

const CORPUS_PATH = fileURLToPath(
    new URL("../../corpus/commands.jsonl", import.meta.url),
);

interface CorpusRecord {
    readonly id: string;
    readonly command: string;
    readonly cwd: string | undefined;
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
            const parsed = JSON.parse(line) as {
                id?: unknown;
                command?: unknown;
                cwd?: unknown;
            };
            if (typeof parsed.command === "string") {
                records.push({
                    id: typeof parsed.id === "string" ? parsed.id : "?",
                    command: parsed.command,
                    cwd: typeof parsed.cwd === "string" ? parsed.cwd : undefined,
                });
            }
        } catch {
            // ignore malformed lines
        }
    }
    return records;
}

const corpus = loadCorpus();

const INITIAL = {
    variables: { HOME: "/home/user", PATH: "/usr/bin:/bin" },
    complete: true,
};

describe("interp corpus", () => {
    if (corpus === undefined) {
        test.skip("corpus/commands.jsonl is not available yet", () => {
            expect(corpus).toBeUndefined();
        });
        return;
    }

    test("interprets every command without throwing", () => {
        const interpreter = createInterpreter();
        let commands = 0;
        let invocations = 0;
        let knownArgv0 = 0;
        let knownCwd = 0;
        let truncated = 0;
        const truncatedIds: string[] = [];
        const thrown: { id: string; message: string }[] = [];
        const nonLiteralArgv0 = new Map<string, number>();
        let unknownArgv0 = 0;

        for (const record of corpus) {
            commands += 1;
            try {
                const result = interpreter.interpret(record.command, {
                    cwd: record.cwd,
                    variables: INITIAL.variables,
                    complete: INITIAL.complete,
                });
                if (result.truncated) {
                    truncated += 1;
                    truncatedIds.push(record.id);
                }
                for (const invocation of result.invocations) {
                    invocations += 1;
                    const first = invocation.argv[0];
                    if (first?.value !== undefined) {
                        knownArgv0 += 1;
                        const origin = first.fragments[0]?.origin.kind;
                        if (origin !== "literal") {
                            nonLiteralArgv0.set(
                                first.value,
                                (nonLiteralArgv0.get(first.value) ?? 0) + 1,
                            );
                        }
                    } else {
                        unknownArgv0 += 1;
                    }
                    if (invocation.context.cwd !== undefined) {
                        knownCwd += 1;
                    }
                }
            } catch (error) {
                thrown.push({
                    id: record.id,
                    message: error instanceof Error ? error.message : String(error),
                });
            }
        }

        const top = [...nonLiteralArgv0.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20);
        console.log(
            `interp corpus: ${commands} commands, ${invocations} invocations ` +
                `(${(invocations / commands).toFixed(2)}/command)`,
        );
        console.log(
            `  argv[0] known: ${((knownArgv0 / Math.max(invocations, 1)) * 100).toFixed(2)}%, ` +
                `cwd known: ${((knownCwd / Math.max(invocations, 1)) * 100).toFixed(2)}%, ` +
                `unknown argv[0]: ${unknownArgv0}, truncated commands: ${truncated}`,
        );
        console.log(`  top non-literal argv[0]: ${JSON.stringify(top)}`);
        if (truncatedIds.length > 0) {
            console.log(`  truncated: ${truncatedIds.slice(0, 20).join(", ")}`);
        }
        for (const failure of thrown.slice(0, 20)) {
            console.log(`  THREW ${failure.id}: ${failure.message}`);
        }

        expect(thrown).toEqual([]);
        expect(truncatedIds).toEqual([]);
    }, 120_000);
});
