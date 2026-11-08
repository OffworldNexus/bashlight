import { describe, expect, test } from "bun:test";

import {
    CachingProjectInspector,
    createProjectInspector,
    MemoizedDetector,
    MemoryFileSystem,
    type NodeToolchain,
    type PythonToolchain,
    type ToolchainDetector,
} from "../../src/project/index.ts";
import { POETRY_LOCK, POETRY_PYPROJECT } from "./fixtures.ts";

function countingDetector<T>(counter: { calls: number }): ToolchainDetector<T> {
    return {
        detect: () => {
            counter.calls += 1;
            return undefined;
        },
    };
}

describe("MemoizedDetector", () => {
    test("memoizes per directory, negative results included", () => {
        const counter = { calls: 0 };
        const detector = new MemoizedDetector(countingDetector<string>(counter));

        expect(detector.detect("/w")).toBeUndefined();
        expect(detector.detect("/w")).toBeUndefined();
        detector.detect("/w/api");

        expect(counter.calls).toBe(2);
    });
});

describe("ProjectInspector", () => {
    test("returns the same toolchain instance for a directory", () => {
        const inspector = createProjectInspector(
            new MemoryFileSystem({
                "/w/api/pyproject.toml": POETRY_PYPROJECT,
                "/w/api/poetry.lock": POETRY_LOCK,
            }),
        );
        expect(inspector.python("/w/api")).toBe(inspector.python("/w/api"));
    });

    test("factory wires the default detectors over the FileSystem", () => {
        const inspector = createProjectInspector(
            new MemoryFileSystem({
                "/w/api/pyproject.toml": POETRY_PYPROJECT,
                "/w/api/poetry.lock": POETRY_LOCK,
                "/w/api/package.json": `{ "name": "api" }`,
                "/w/api/package-lock.json": "",
            }),
        );

        const python = inspector.python("/w/api");
        expect(python?.ecosystem).toBe("python");
        expect(python?.manager).toBe("poetry");

        const node = inspector.node("/w/api");
        expect(node?.ecosystem).toBe("node");
        expect(node?.manager).toBe("npm");

        expect(inspector.python("/nope")).toBeUndefined();
        expect(inspector.node("/nope")).toBeUndefined();
    });

    test("memoizes detection when detectors are decorated", () => {
        const pythonCounter = { calls: 0 };
        const nodeCounter = { calls: 0 };
        const inspector = new CachingProjectInspector(
            new MemoizedDetector<PythonToolchain>(countingDetector(pythonCounter)),
            new MemoizedDetector<NodeToolchain>(countingDetector(nodeCounter)),
        );

        inspector.python("/w");
        inspector.python("/w");
        inspector.python("/w/api");
        inspector.node("/w");
        inspector.node("/w");

        expect(pythonCounter.calls).toBe(2);
        expect(nodeCounter.calls).toBe(1);
    });
});
