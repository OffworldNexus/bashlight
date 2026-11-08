#!/usr/bin/env bun
/**
 * `bun bench/run.ts` — the benchmark matrix runner.
 *
 * Wires the real adapters (filesystem, process runner, OpenCode CLI, isolated
 * environment, credentials) into {@link BenchRunner} and runs the requested
 * matrix sequentially, stopping early if the projected cost would exceed the
 * cap. See the README section on the benchmark for the flags.
 */

import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { parseRunArgs, USAGE } from "./lib/args.ts";
import { type BenchConfig, BenchRunner, envRecord } from "./lib/bench-runner.ts";
import { ProcessRunner } from "./lib/command.ts";
import { OpenRouterCredentials } from "./lib/credentials.ts";
import { NodeBenchFileSystem } from "./lib/fs.ts";
import { Isolation } from "./lib/isolation.ts";
import { OpenCodeRunner } from "./lib/opencode-runner.ts";
import { ResultsStore } from "./lib/results-store.ts";
import { TemplatePreparer } from "./lib/template.ts";
import { TASKS } from "./tasks.ts";

/** Cheap, tool-capable models from three different families. */
export const DEFAULT_MODELS = [
    "openrouter/deepseek/deepseek-v4.1-flash",
    "openrouter/openai/gpt-5-nano",
    "openrouter/anthropic/claude-haiku-5.5",
] as const;

async function main(): Promise<number> {
    const benchDir = import.meta.dirname;
    const repoRoot = dirname(benchDir);
    const projectNames = TASKS.map((task) => task.project);

    const argv = process.argv.slice(2);
    const parsed = parseRunArgs(argv, {
        models: [...DEFAULT_MODELS],
        projects: projectNames,
    });
    if (!parsed.ok) {
        if (parsed.error !== "help") {
            process.stderr.write(`error: ${parsed.error}\n\n`);
        }
        process.stderr.write(USAGE);
        return parsed.error === "help" ? 0 : 1;
    }
    const options = parsed.options;
    const projects = options.projects.includes("all") ? projectNames : options.projects;
    const knownProjects = new Set(projectNames);
    const unknown = projects.filter((name) => !knownProjects.has(name));
    if (unknown.length > 0) {
        process.stderr.write(`error: unknown project(s): ${unknown.join(", ")}\n`);
        return 1;
    }

    const fs = new NodeBenchFileSystem();
    const clock = { now: () => Date.now() };
    const processRunner = new ProcessRunner(clock);
    const sharedCache = join(benchDir, ".cache");
    for (const key of ["poetry", "uv", "pip", "npm", "pnpm-store"]) {
        fs.mkdirp(join(sharedCache, key));
    }
    const startedAt = new Date();
    const resultsFile = join(
        benchDir,
        "results",
        `${startedAt.toISOString().replace(/[:.]/g, "-")}.jsonl`,
    );
    fs.mkdirp(join(benchDir, "results"));
    fs.mkdirp(join(benchDir, "runs"));
    const runsDir = join(tmpdir(), "opencode", "bench-runs");
    fs.mkdirp(runsDir);

    const config: BenchConfig = {
        repoRoot,
        templatesDir: join(benchDir, "projects"),
        runsDir,
        artifactsDir: join(benchDir, "runs"),
        resultsFile,
        sharedCache,
        pluginEntry: join(repoRoot, "src", "opencode", "plugin.ts"),
        opencodeBinary: "opencode",
    };
    const runner = new BenchRunner(
        {
            fs,
            processRunner,
            openCodeRunner: new OpenCodeRunner(processRunner, config.opencodeBinary),
            preparer: new TemplatePreparer(fs, processRunner),
            isolation: new Isolation(fs),
            credentials: new OpenRouterCredentials({
                env: envRecord(),
                readText: (path) => fs.readFile(path),
            }),
            results: new ResultsStore(fs, resultsFile),
            logger: { line: (text) => process.stdout.write(`${text}\n`) },
            clock,
        },
        config,
        TASKS,
    );

    const records = await runner.run({ ...options, projects });
    if (!options.dryRun) {
        const total = records.reduce((sum, record) => sum + record.costUsd, 0);
        const passed = records.filter((record) => record.success).length;
        process.stdout.write(
            `\n${records.length} runs · ${passed} passed · $${total.toFixed(4)} spent\n` +
                `results: ${resultsFile}\n`,
        );
    }
    return 0;
}

main().then(
    (code) => process.exit(code),
    (error: unknown) => {
        process.stderr.write(`fatal: ${String(error)}\n`);
        process.exit(1);
    },
);
