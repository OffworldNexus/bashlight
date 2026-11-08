import type { ToolchainDetector } from "./detector.ts";
import type { FileSystem } from "./file-system.ts";
import { MemoizedDetector } from "./memoized-detector.ts";
import { NodeToolchainDetector } from "./node-detector.ts";
import { PythonToolchainDetector } from "./python-detector.ts";
import type { NodeToolchain, PythonToolchain } from "./toolchain.ts";

/**
 * Answers toolchain questions about a directory. The rules depend on this
 * interface only, so tests can substitute a stub.
 */
export interface ProjectInspector {
    /** The Python toolchain governing `dir`, if any. */
    python(dir: string): PythonToolchain | undefined;
    /** The Node toolchain governing `dir`, if any. */
    node(dir: string): NodeToolchain | undefined;
}

/**
 * Concrete `ProjectInspector` over the per-ecosystem detectors. Detection is
 * memoized per directory (negative results included) by the injected
 * `MemoizedDetector`s, so one inspector is meant to live for a single processed
 * command. Adding an ecosystem means adding a detector and a façade method.
 */
export class CachingProjectInspector implements ProjectInspector {
    constructor(
        private readonly pythonDetector: ToolchainDetector<PythonToolchain>,
        private readonly nodeDetector: ToolchainDetector<NodeToolchain>,
    ) {}

    python(dir: string): PythonToolchain | undefined {
        return this.pythonDetector.detect(dir);
    }

    node(dir: string): NodeToolchain | undefined {
        return this.nodeDetector.detect(dir);
    }
}

/** Wires the default detectors over `fs`, each memoized per directory. */
export function createProjectInspector(fs: FileSystem): ProjectInspector {
    return new CachingProjectInspector(
        new MemoizedDetector(new PythonToolchainDetector(fs)),
        new MemoizedDetector(new NodeToolchainDetector(fs)),
    );
}
