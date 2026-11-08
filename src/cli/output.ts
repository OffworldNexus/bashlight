/**
 * Where a CLI command writes its lines.
 *
 * Commands never touch the console: they receive an `Output` and decide whether
 * to colour their text from `colors`. `ConsoleOutput` is the only implementation
 * allowed to reach for `process.stdout`, exactly like `NodeFileSystem` is the
 * only file-system adapter that touches the disk.
 */

/** A sink for whole lines of text. */
export interface Output {
    /** Whether ANSI colour is wanted (a TTY, or a caller that forced it on). */
    readonly colors: boolean;
    /** Writes one line; `undefined` writes an empty line. */
    line(text?: string): void;
}

/** The production `Output`, writing to stdout. */
export class ConsoleOutput implements Output {
    constructor(readonly colors: boolean) {}

    line(text = ""): void {
        process.stdout.write(`${text}\n`);
    }
}
