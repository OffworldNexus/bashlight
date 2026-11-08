/**
 * Strategy interface for toolchain detection. One implementation per
 * ecosystem; the `ProjectInspector` is composed from detectors, so adding
 * Ruby/Go later means adding a detector instead of editing the inspector.
 */
export interface ToolchainDetector<T> {
    /** Detects the toolchain governing `dir` (absolute POSIX path), if any. */
    detect(dir: string): T | undefined;
}
