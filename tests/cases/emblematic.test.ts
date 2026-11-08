/* eslint-disable sonarjs/function-return-type */
/**
 * End-to-end cases drawn from the private command corpus and rewritten by hand
 * into generic, fictional commands (see `tests/cases/emblematic.jsonl`).
 *
 * Each case names a project type; the test materializes that project's fixture
 * tree at the case's `cwd` (its project root), runs the real `createBashlight`
 * pipeline and compares the whole outcome. A case with a `knownIssue` is
 * registered as a skipped todo test, so the suspected bug stays visible without
 * failing the suite.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "bun:test";

import { createBashlight } from "../../src/bashlight.ts";
import { MemoryFileSystem } from "../../src/project/index.ts";
import { isRecord } from "../../src/shared/guards.ts";
import {
    bunProject,
    DEFAULT_ENV,
    type Fixtures,
    noProject,
    npmProject,
    pnpmProject,
    poetryProject,
    tsxProject,
    uvProject,
    venvProject,
    yarnProject,
} from "./fixtures.ts";

const CASES_PATH = fileURLToPath(new URL("./emblematic.jsonl", import.meta.url));

type Expected =
    | { readonly kind: "rewritten"; readonly command: string }
    | { readonly kind: "unchanged" }
    | { readonly kind: "blocked" };

interface EmblematicCase {
    readonly name: string;
    readonly project: string;
    readonly cwd: string;
    readonly command: string;
    readonly expected: Expected;
    readonly knownIssue?: string;
}

const BUILDERS: Readonly<Record<string, (root: string) => Fixtures>> = {
    poetry: poetryProject,
    uv: uvProject,
    venv: venvProject,
    pnpm: pnpmProject,
    npm: npmProject,
    yarn: yarnProject,
    bun: bunProject,
    tsx: tsxProject,
    none: noProject,
};

function loadCases(): EmblematicCase[] {
    return readFileSync(CASES_PATH, "utf8")
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map(parseCase);
}

function parseCase(line: string): EmblematicCase {
    let parsed: unknown;
    try {
        parsed = JSON.parse(line);
    } catch {
        throw new Error(`emblematic case is not valid JSON: ${line}`);
    }
    if (!isRecord(parsed)) {
        throw new Error(`emblematic case is not an object: ${line}`);
    }
    const { name, project, cwd, command } = parsed;
    if (
        typeof name !== "string" ||
        typeof project !== "string" ||
        typeof cwd !== "string" ||
        typeof command !== "string"
    ) {
        throw new Error(`emblematic case has invalid fields: ${line}`);
    }
    const parsedCase: EmblematicCase = {
        name,
        project,
        cwd,
        command,
        expected: parseExpected(parsed["expected"], line),
    };
    return typeof parsed["knownIssue"] === "string"
        ? { ...parsedCase, knownIssue: parsed["knownIssue"] }
        : parsedCase;
}

function parseExpected(value: unknown, line: string): Expected {
    if (isRecord(value)) {
        if (value["kind"] === "unchanged" || value["kind"] === "blocked") {
            return { kind: value["kind"] };
        }
        if (value["kind"] === "rewritten" && typeof value["command"] === "string") {
            return { kind: "rewritten", command: value["command"] };
        }
    }
    throw new Error(`emblematic case has an invalid expectation: ${line}`);
}

function runCase(testCase: EmblematicCase): Expected {
    const builder = BUILDERS[testCase.project];
    if (builder === undefined) {
        throw new Error(`unknown project type "${testCase.project}"`);
    }
    const processor = createBashlight({
        fileSystem: new MemoryFileSystem(builder(testCase.cwd)),
    });
    const outcome = processor.process({
        command: testCase.command,
        cwd: testCase.cwd,
        env: DEFAULT_ENV,
    });
    if (outcome.kind === "rewritten") {
        return { kind: "rewritten", command: outcome.command };
    }
    if (outcome.kind === "blocked") {
        return { kind: "blocked" };
    }
    return { kind: "unchanged" };
}

describe("emblematic corpus cases", () => {
    const cases = loadCases();

    test("the case file is not empty", () => {
        expect(cases.length).toBeGreaterThan(0);
    });

    for (const testCase of cases) {
        const label = `${testCase.project}: ${testCase.name}`;
        if (testCase.knownIssue !== undefined) {
            test.todo(`${label} — known issue: ${testCase.knownIssue}`);
            continue;
        }
        test(label, () => {
            expect(runCase(testCase)).toEqual(testCase.expected);
        });
    }
});
