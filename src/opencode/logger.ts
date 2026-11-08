/**
 * Minimal logging seam for the OpenCode adapter.
 *
 * The adapter never touches the console directly except through this injected
 * interface: internal failures are reported here and never surfaced to
 * OpenCode, so a broken plugin leaves the agent's command untouched.
 */
export interface Logger {
    /** Reports a non-fatal failure; the caller keeps going. */
    error(message: string, cause?: unknown): void;
}

/**
 * The production `Logger`, writing to stderr with a stable prefix.
 *
 * It is an adapter (like `NodeFileSystem`): the only place in the adapter that
 * is allowed to reach for the console.
 */
export class ConsoleLogger implements Logger {
    error(message: string, cause?: unknown): void {
        if (cause === undefined) {
            console.error(`[bashlight] ${message}`);
        } else {
            console.error(`[bashlight] ${message}`, cause);
        }
    }
}
