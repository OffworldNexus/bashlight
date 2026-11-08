/**
 * Turning a committed project template into a disposable run copy.
 *
 * The template holds only source and lockfiles; virtualenvs, `node_modules`
 * and caches are never copied. Each run gets a fresh tree and then one or more
 * "hydrate" install steps (a monorepo has two toolchains), so runs are
 * independent while staying fast.
 */

import { join } from "node:path";

import type { CommandResult } from "./command.ts";
import { ProcessRunner } from "./command.ts";
import type { BenchFileSystem } from "./fs.ts";

/** One executable plus its arguments, optionally in a subdirectory. */
export interface CommandSpec {
    readonly command: string;
    readonly args: readonly string[];
    /** Directory relative to the project root; defaults to the root. */
    readonly cwd?: string;
}

/** A spec resolved against a project directory, ready to spawn. */
export interface ResolvedCommand {
    readonly command: string;
    readonly args: readonly string[];
    readonly cwd: string;
}

/** Resolves a step's `cwd` against the project root. */
export function resolveCommand(
    spec: CommandSpec,
    projectDirectory: string,
): ResolvedCommand {
    return {
        command: spec.command,
        args: spec.args,
        cwd:
            spec.cwd === undefined
                ? projectDirectory
                : join(projectDirectory, spec.cwd),
    };
}

/** Paths that must never travel from a template into a run copy. */
const SKIPPED_SEGMENTS = [
    "/.venv/",
    "/node_modules/",
    "/.git/",
    "/__pycache__/",
    "/.pytest_cache/",
    "/.ruff_cache/",
    "/.mypy_cache/",
];

/** True for build artifacts that belong to the machine, not the template. */
export function isArtifactPath(path: string): boolean {
    const normalised = path.endsWith("/") ? path.slice(0, -1) : path;
    return SKIPPED_SEGMENTS.some((segment) => `${normalised}/`.includes(segment));
}

export interface PrepareInput {
    readonly templateDirectory: string;
    readonly destination: string;
    readonly install: readonly CommandSpec[];
    readonly env: Readonly<Record<string, string>>;
    readonly timeoutMs: number;
}

/** A completed result for a step-less project (nothing to install). */
function noInstall(): CommandResult {
    return {
        code: 0,
        signal: null,
        stdout: "",
        stderr: "",
        timedOut: false,
        durationMs: 0,
    };
}

/** Copies a template and runs its install steps, stopping at the first failure. */
export class TemplatePreparer {
    constructor(
        private readonly fs: BenchFileSystem,
        private readonly runner: ProcessRunner,
    ) {}

    async prepare(input: PrepareInput): Promise<CommandResult> {
        this.fs.copyTree(input.templateDirectory, input.destination, isArtifactPath);
        let last = noInstall();
        for (const step of input.install) {
            const resolved = resolveCommand(step, input.destination);
            last = await this.runner.run({
                command: resolved.command,
                args: resolved.args,
                cwd: resolved.cwd,
                env: input.env,
                timeoutMs: input.timeoutMs,
            });
            if (last.code !== 0) {
                return last;
            }
        }
        return last;
    }
}
