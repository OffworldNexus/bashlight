/**
 * The benchmark runner: the matrix, the per-run lifecycle, concurrency and the
 * cost guard.
 *
 * A run is: create the isolated tree, copy and hydrate the template, install
 * the plugin (in `with` mode), drive `opencode run` headlessly, parse the
 * event stream, run the success checker and summarise the audit log. One result
 * line is appended per run. Cells run through a small worker pool so several
 * isolated runs proceed at once; the cost guard reserves the cost of the runs
 * already in flight. Every collaborator is injected so the orchestration can be
 * exercised with fakes.
 */

import type { TaskDefinition } from "../tasks.ts";
import { summarizeAudit } from "./audit-summary.ts";
import { ProcessRunner } from "./command.ts";
import { CostGuard } from "./cost-guard.ts";
import type { OpenRouterCredentials } from "./credentials.ts";
import { parseActivity } from "./events.ts";
import type { BenchFileSystem } from "./fs.ts";
import { Isolation } from "./isolation.ts";
import type { OpenCodeRunner } from "./opencode-runner.ts";
import type { ResultsStore } from "./results-store.ts";
import { resolveCommand, TemplatePreparer } from "./template.ts";
import type { Mode, RunRecord } from "./types.ts";

/** Filesystem layout and binaries the runner needs. */
export interface BenchConfig {
    /** Absolute path of this checkout. */
    readonly repoRoot: string;
    readonly templatesDir: string;
    /** Where disposable working copies go (outside the repo). */
    readonly runsDir: string;
    /** Where raw event logs are kept (inside `bench/`, gitignored). */
    readonly artifactsDir: string;
    readonly resultsFile: string;
    readonly sharedCache: string;
    /** Absolute path of `src/opencode/plugin.ts`. */
    readonly pluginEntry: string;
    readonly opencodeBinary: string;
}

/** One cell of the project × mode × model × repeat matrix. */
export interface BenchCell {
    readonly project: string;
    readonly mode: Mode;
    readonly model: string;
    readonly iteration: number;
}

/** Minimal progress sink, injectable so tests stay silent. */
export interface BenchLogger {
    line(text: string): void;
}

export interface BenchDependencies {
    readonly fs: BenchFileSystem;
    readonly processRunner: ProcessRunner;
    readonly openCodeRunner: OpenCodeRunner;
    readonly preparer: TemplatePreparer;
    readonly isolation: Isolation;
    readonly credentials: OpenRouterCredentials;
    readonly results: ResultsStore;
    readonly logger: BenchLogger;
    readonly clock: { now(): number };
}

export interface BenchRunOptions {
    readonly models: readonly string[];
    readonly modes: readonly Mode[];
    readonly projects: readonly string[];
    readonly repeat: number;
    readonly dryRun: boolean;
    readonly maxCostUsd: number;
    readonly timeoutMs: number;
    /** How many runs may execute at once. */
    readonly jobs: number;
}

const TASK_INSTALL_TIMEOUT_MS = 300_000;
const CHECK_TIMEOUT_MS = 300_000;

/** Expands the matrix in a stable order, repeats as the innermost loop. */
export function buildMatrix(options: BenchRunOptions): readonly BenchCell[] {
    const cells: BenchCell[] = [];
    for (const project of options.projects) {
        for (const mode of options.modes) {
            for (const model of options.models) {
                for (let iteration = 1; iteration <= options.repeat; iteration += 1) {
                    cells.push({ project, mode, model, iteration });
                }
            }
        }
    }
    return cells;
}

/** Shortens a `runId`-legal token from a model or project name. */
export function slug(value: string): string {
    return value.replaceAll("/", "-").replaceAll("#", "-").replaceAll(":", "-");
}

export class BenchRunner {
    constructor(
        private readonly deps: BenchDependencies,
        private readonly config: BenchConfig,
        private readonly tasks: readonly TaskDefinition[],
    ) {}

    async run(options: BenchRunOptions): Promise<readonly RunRecord[]> {
        const cells = buildMatrix(options);
        if (options.dryRun) {
            this.deps.logger.line(
                `dry run: ${cells.length} runs, ${options.jobs} at a time`,
            );
            for (const cell of cells) {
                this.deps.logger.line(
                    `  ${cell.project} ${cell.mode} ${cell.model} #${cell.iteration}`,
                );
            }
            return [];
        }
        const guard = new CostGuard(options.maxCostUsd);
        const records: RunRecord[] = [];
        const runStamp = compactStamp(new Date(this.deps.clock.now()));
        const total = cells.length;
        const workers = Math.max(1, Math.min(options.jobs, total));
        let next = 0;
        let launched = 0;
        let inFlight = 0;
        let stopped = false;

        const worker = async (): Promise<void> => {
            for (;;) {
                if (stopped) {
                    return;
                }
                const projection = guard.check(inFlight);
                if (projection.stop) {
                    stopped = true;
                    this.deps.logger.line(
                        `stopping: spent $${projection.spent.toFixed(4)} + projected $${projection.projection.toFixed(4)} exceeds $${options.maxCostUsd}`,
                    );
                    return;
                }
                const cell = cells[next];
                if (cell === undefined) {
                    return;
                }
                next += 1;
                launched += 1;
                inFlight += 1;
                let record: RunRecord;
                try {
                    record = await this.runCell(cell, runStamp, options);
                } catch (error) {
                    record = this.errorRecord(cell, `run failed: ${String(error)}`, 0);
                } finally {
                    inFlight -= 1;
                }
                this.deps.results.append(record);
                records.push(record);
                guard.record(record.costUsd);
                this.deps.logger.line(
                    `[${launched}/${total}] ${cell.project} ${cell.mode} ${cell.model} #${cell.iteration} → ${record.success ? "pass" : "fail"} · $${record.costUsd.toFixed(4)} · ${(record.wallMs / 1000).toFixed(1)}s · in ${record.tokens.input} out ${record.tokens.output}`,
                );
            }
        };

        await Promise.all(Array.from({ length: workers }, worker));
        return records;
    }

    /** Runs one cell end to end and returns its record. */
    private async runCell(
        cell: BenchCell,
        runStamp: string,
        options: BenchRunOptions,
    ): Promise<RunRecord> {
        const task = this.tasks.find((item) => item.project === cell.project);
        if (task === undefined) {
            return this.errorRecord(cell, "unknown project", 0);
        }
        const runId = `${runStamp}-${cell.project}-${cell.mode}-${slug(cell.model)}-r${cell.iteration}`;
        const runDirectory = `${this.config.runsDir}/${runId}`;
        const projectDirectory = `${runDirectory}/project`;
        this.deps.fs.mkdirp(runDirectory);

        const isolated = this.deps.isolation.setup({
            runDirectory,
            projectDirectory,
            sharedCache: this.config.sharedCache,
            apiKey: this.deps.credentials.key(),
            parentEnv: envRecord(),
        });

        const hydrated = await this.deps.preparer.prepare({
            templateDirectory: `${this.config.templatesDir}/${cell.project}`,
            destination: projectDirectory,
            install: task.install,
            env: isolated.env,
            timeoutMs: TASK_INSTALL_TIMEOUT_MS,
        });
        if (hydrated.code !== 0) {
            this.writeArtifacts(runId, "", hydrated.stderr, "hydration failed", "");
            return this.errorRecord(
                cell,
                `hydration failed: ${firstLine(hydrated.stderr)}`,
                0,
            );
        }
        this.deps.isolation.installPlugin({
            projectDirectory,
            mode: cell.mode,
            pluginEntry: this.config.pluginEntry,
        });

        const startedAt = new Date(this.deps.clock.now());
        const result = await this.deps.openCodeRunner.run({
            model: cell.model,
            prompt: task.prompt,
            cwd: projectDirectory,
            env: isolated.env,
            timeoutMs: options.timeoutMs,
        });
        const activity = parseActivity(result.stdout);
        const check = await task.check({
            projectDirectory,
            fs: this.deps.fs,
            run: (spec) => {
                const resolved = resolveCommand(spec, projectDirectory);
                return this.deps.processRunner.run({
                    command: resolved.command,
                    args: resolved.args,
                    cwd: resolved.cwd,
                    env: isolated.env,
                    timeoutMs: CHECK_TIMEOUT_MS,
                });
            },
        });
        const auditText =
            cell.mode === "with"
                ? (this.deps.fs.readFile(isolated.auditLogPath) ?? "")
                : "";
        const audit = summarizeAudit(auditText);
        this.writeArtifacts(
            runId,
            result.stdout,
            result.stderr,
            check.detail,
            auditText,
        );
        let error: string | undefined;
        if (activity.errors.length > 0) {
            error = activity.errors.join("; ");
        } else if (result.timedOut) {
            error = "timed out";
        }
        const record: RunRecord = {
            runId,
            timestamp: startedAt.toISOString(),
            project: cell.project,
            mode: cell.mode,
            model: cell.model,
            success: check.success && !result.timedOut,
            detail: check.detail,
            wallMs: result.durationMs,
            tokens: activity.tokens,
            costUsd: activity.costUsd,
            toolCalls: activity.toolCalls,
            shellCalls: activity.shellCalls,
            failedShellCalls: activity.failedShellCalls,
            rewrites: audit.rewrites,
            blocks: audit.blocks,
            lastGreenMs: activity.lastGreenMs,
            ...(error === undefined ? {} : { error }),
        };
        return record;
    }

    /** Persists the raw stdout/stderr, audit log and check detail for one run. */
    private writeArtifacts(
        runId: string,
        stdout: string,
        stderr: string,
        detail: string,
        auditText: string,
    ): void {
        const directory = `${this.config.artifactsDir}/${runId}`;
        this.deps.fs.writeFile(`${directory}/events.jsonl`, stdout);
        this.deps.fs.writeFile(`${directory}/stderr.log`, stderr);
        this.deps.fs.writeFile(`${directory}/audit.jsonl`, auditText);
        this.deps.fs.writeFile(`${directory}/check.txt`, `${detail}\n`);
    }

    /** A record for a run that never got as far as the model. */
    private errorRecord(cell: BenchCell, error: string, wallMs: number): RunRecord {
        return {
            runId: `${compactStamp(new Date(this.deps.clock.now()))}-${cell.project}-${cell.mode}-${slug(cell.model)}-r${cell.iteration}`,
            timestamp: new Date(this.deps.clock.now()).toISOString(),
            project: cell.project,
            mode: cell.mode,
            model: cell.model,
            success: false,
            detail: error,
            wallMs,
            tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
            costUsd: 0,
            toolCalls: 0,
            shellCalls: 0,
            failedShellCalls: 0,
            rewrites: 0,
            blocks: 0,
            lastGreenMs: 0,
            error,
        };
    }
}

/** The process environment as a string record, dropping undefined entries. */
export function envRecord(
    env: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string> {
    const record: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
        if (value !== undefined) {
            record[key] = value;
        }
    }
    return record;
}

function compactStamp(date: Date): string {
    return date.toISOString().replace(/[-:]/g, "").replace(/\..*/, "Z");
}

function firstLine(text: string): string {
    return text.trim().split("\n")[0] ?? "";
}
