/**
 * Turning a committed project template into a disposable run copy.
 *
 * The template holds only source and lockfiles; virtualenvs, `node_modules`
 * and caches are never copied. Each run gets a fresh tree and then a one-shot
 * "hydrate" install using the shared package caches, so runs are independent
 * while staying fast.
 */

import type { CommandResult } from "./command.ts";
import { ProcessRunner } from "./command.ts";
import type { BenchFileSystem } from "./fs.ts";

/** One executable plus its arguments, with no shell involved. */
export interface CommandSpec {
    readonly command: string;
    readonly args: readonly string[];
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
    readonly install: CommandSpec;
    readonly env: Readonly<Record<string, string>>;
    readonly timeoutMs: number;
}

/** Copies a template and hydrates it with its package manager. */
export class TemplatePreparer {
    constructor(
        private readonly fs: BenchFileSystem,
        private readonly runner: ProcessRunner,
    ) {}

    async prepare(input: PrepareInput): Promise<CommandResult> {
        this.fs.copyTree(input.templateDirectory, input.destination, isArtifactPath);
        return this.runner.run({
            command: input.install.command,
            args: input.install.args,
            cwd: input.destination,
            env: input.env,
            timeoutMs: input.timeoutMs,
        });
    }
}
