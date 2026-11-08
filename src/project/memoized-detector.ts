import type { ToolchainDetector } from "./detector.ts";

/**
 * Decorates a detector with a per-directory memo, negative results included.
 *
 * Detection reads the disk, so the cache lives for one processed command: the
 * composition root wires one `MemoizedDetector` per ecosystem.
 */
export class MemoizedDetector<T> implements ToolchainDetector<T> {
    private readonly cache = new Map<string, T | undefined>();

    constructor(private readonly detector: ToolchainDetector<T>) {}

    detect(dir: string): T | undefined {
        if (!this.cache.has(dir)) {
            this.cache.set(dir, this.detector.detect(dir));
        }
        return this.cache.get(dir);
    }
}
