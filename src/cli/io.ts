/**
 * Everything a CLI command collaborates with, injected by the composition root
 * (`main.ts`). Commands never reach for `process.*`, the clock or the disk
 * directly; tests build a `CommandIo` out of fakes.
 */

import type { CommandProcessor } from "../outcome.ts";
import type { FileSystem } from "../project/index.ts";
import type { RuleAccess } from "../rules/custom/index.ts";
import type { Rule } from "../rules/rule.ts";
import type { Clock } from "./clock.ts";
import type { CliFiles } from "./files.ts";
import type { Output } from "./output.ts";
import type { ProcessRunner } from "./process-runner.ts";
import type { Scheduler } from "./scheduler.ts";

/** The environment and process seams a command runs against. */
export interface CommandIo {
    readonly output: Output;
    readonly clock: Clock;
    readonly scheduler: Scheduler;
    /** File access with size/listing/writability, for the log and doctor. */
    readonly files: CliFiles;
    /** The read-only view the core inspects projects through. */
    readonly fileSystem: FileSystem;
    readonly runner: ProcessRunner;
    /** The process environment (`process.env` in production). */
    readonly env: Readonly<Record<string, string | undefined>>;
    /** The current working directory, resolved from `process.cwd()`. */
    readonly cwd: string;
    /** The whole of stdin, read on demand (`explain -`). */
    readonly readStdin: () => Promise<string>;
    /** Aborted on Ctrl-C / SIGTERM, so follow loops stop cleanly. */
    readonly signal: AbortSignal;
    /**
     * Builds a processor over a file system; when `rules` is given the engine
     * uses them, otherwise the built-ins.
     */
    readonly processorFactory: (
        fileSystem: FileSystem,
        rules?: readonly Rule[],
    ) => CommandProcessor;
    /** The custom-rule catalog, shared by `explain`, `rules` and `doctor`. */
    readonly ruleAccess: RuleAccess;
}
