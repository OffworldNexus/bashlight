import type { ToolchainDetector } from "./detector.ts";
import type { FileSystem } from "./file-system.ts";
import { MemoizedDetector } from "./memoized-detector.ts";
import { NodeToolchainDetector } from "./node-detector.ts";
import { PythonToolchainDetector } from "./python-detector.ts";
import type { NodeToolchain, PythonToolchain } from "./toolchain.ts";

/**
 * Typed façade over the per-ecosystem detectors. Detection is memoized per
 * directory (negative results included) by the injected `MemoizedDetector`s, so
 * one inspector is meant to live for a single processed command. Adding an
 * ecosystem means adding a detector and a façade method, not editing the
 * existing ones.
 */
export class ProjectInspector {
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
    return new ProjectInspector(
        new MemoizedDetector(new PythonToolchainDetector(fs)),
        new MemoizedDetector(new NodeToolchainDetector(fs)),
    );
}
