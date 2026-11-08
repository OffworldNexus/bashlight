import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createBashlight } from "../../src/bashlight.ts";
import type { Clock } from "../../src/cli/clock.ts";
import { type CliFiles, NodeCliFiles } from "../../src/cli/files.ts";
import type { CommandIo } from "../../src/cli/io.ts";
import type { Output } from "../../src/cli/output.ts";
import type { ProcessRunner, RunResult } from "../../src/cli/process-runner.ts";
import type { Scheduler } from "../../src/cli/scheduler.ts";
import { createBuiltinRules } from "../../src/rules/builtin/index.ts";
import type { CatalogReport, RuleAccess } from "../../src/rules/custom/index.ts";
import type { Rule } from "../../src/rules/rule.ts";

/** An `Output` that keeps every line it was asked to write. */
export class FakeOutput implements Output {
    readonly lines: string[] = [];

    constructor(readonly colors = false) {}

    line(text = ""): void {
        this.lines.push(text);
    }

    /** The lines joined by newlines, for `toContain` assertions. */
    text(): string {
        return this.lines.join("\n");
    }
}

/** A `Clock` frozen on one instant, movable between assertions. */
export class FixedClock implements Clock {
    constructor(private instant: Date) {}

    now(): Date {
        return this.instant;
    }

    set(instant: Date): void {
        this.instant = instant;
    }
}

/**
 * A `Scheduler` that runs one scripted callback per `sleep`, then asks the loop
 * to stop. The callback typically appends to the log under test.
 */
export class ScriptedScheduler implements Scheduler {
    readonly slept: number[] = [];
    private count = 0;

    constructor(
        private readonly ticks: readonly (() => void)[],
        private readonly stop: () => void = () => {},
    ) {}

    sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
        this.slept.push(milliseconds);
        if (signal.aborted) {
            return Promise.resolve();
        }
        const tick = this.ticks[this.count];
        this.count += 1;
        if (tick === undefined) {
            this.stop();
            return Promise.resolve();
        }
        tick();
        return Promise.resolve();
    }
}

/** A `ProcessRunner` answering from a fixed table. */
export class StaticRunner implements ProcessRunner {
    constructor(
        private readonly results: Readonly<Record<string, RunResult | undefined>> = {},
    ) {}

    run(program: string): RunResult | undefined {
        return this.results[program];
    }
}

/** A `CliFiles` over an in-memory path map, for the doctor's layout probes. */
export class FakeCliFiles implements CliFiles {
    private readonly entries: Map<string, string | null>;

    constructor(
        entries: Readonly<Record<string, string | null>> = {},
        private readonly writable = true,
    ) {
        this.entries = new Map(Object.entries(entries));
    }

    exists(path: string): boolean {
        return this.entries.has(path);
    }

    isDirectory(path: string): boolean {
        return this.entries.get(path) === null;
    }

    readText(path: string): string | undefined {
        const value = this.entries.get(path);
        return typeof value === "string" ? value : undefined;
    }

    readHead(path: string, maxBytes: number): string | undefined {
        const text = this.readText(path);
        return text === undefined ? undefined : text.slice(0, maxBytes);
    }

    size(path: string): number | undefined {
        const value = this.entries.get(path);
        return typeof value === "string" ? value.length : undefined;
    }

    list(path: string): readonly string[] {
        const prefix = path.endsWith("/") ? path : `${path}/`;
        const names = new Set<string>();
        for (const key of this.entries.keys()) {
            if (!key.startsWith(prefix)) {
                continue;
            }
            const rest = key.slice(prefix.length);
            const slash = rest.indexOf("/");
            names.add(slash === -1 ? rest : rest.slice(0, slash));
        }
        return [...names].sort((left, right) => left.localeCompare(right));
    }

    canWrite(): boolean {
        return this.writable;
    }
}

/** A `RuleAccess` with the built-ins alone; tests override it when needed. */
export class FakeRuleAccess implements RuleAccess {
    constructor(private readonly snapshot: CatalogReport = { rules: [], errors: [] }) {}

    prepare(): Promise<void> {
        return Promise.resolve();
    }

    rulesFor(): readonly Rule[] {
        return createBuiltinRules();
    }

    report(): CatalogReport {
        return this.snapshot;
    }
}

/** Builds a `CommandIo` with fakes; every field can be overridden. */
export function testIo(overrides: Partial<CommandIo> = {}): CommandIo {
    const files = overrides.files ?? new NodeCliFiles();
    return {
        output: new FakeOutput(),
        clock: new FixedClock(new Date("2026-11-08T12:00:00.000Z")),
        scheduler: new ScriptedScheduler([]),
        files,
        fileSystem: overrides.fileSystem ?? files,
        runner: new StaticRunner(),
        env: { HOME: "/home/u" },
        cwd: "/w",
        readStdin: () => Promise.resolve(""),
        signal: new AbortController().signal,
        processorFactory: (fileSystem, rules) =>
            createBashlight({
                fileSystem,
                ...(rules === undefined ? {} : { rules }),
            }),
        ruleAccess: overrides.ruleAccess ?? new FakeRuleAccess(),
        ...overrides,
    };
}

/** The `FakeOutput` of an io built by {@link testIo}. */
export function outputOf(io: CommandIo): FakeOutput {
    return io.output as FakeOutput;
}

/** Fields an audit line writer would put in one JSONL entry. */
export interface AuditLineFields {
    readonly time?: string;
    readonly sessionID?: string;
    readonly callID?: string;
    readonly cwd?: string;
    readonly original?: string;
    readonly outcome?: "rewritten" | "blocked" | "unchanged";
    readonly command?: string;
    readonly message?: string;
    readonly ruleIds?: readonly string[];
    readonly reasons?: readonly string[];
}

/** Serializes one audit entry, matching `JsonlAuditLog`'s shape. */
export function auditLine(fields: AuditLineFields = {}): string {
    const outcome = fields.outcome ?? "rewritten";
    return `${JSON.stringify({
        time: fields.time ?? "2026-11-08T11:00:00.000Z",
        sessionID: fields.sessionID ?? "ses_1234567890ab",
        callID: fields.callID ?? "call_1",
        cwd: fields.cwd ?? "/home/u/project",
        original: fields.original ?? "pip install requests",
        outcome,
        ...(outcome === "rewritten"
            ? { command: fields.command ?? "poetry add requests" }
            : {}),
        ...(outcome === "blocked" ? { message: fields.message ?? "blocked" } : {}),
        ruleIds: fields.ruleIds ?? (outcome === "rewritten" ? ["pip-to-manager"] : []),
        reasons: fields.reasons ?? (outcome === "rewritten" ? ["use the manager"] : []),
    })}\n`;
}

const BASE = join(tmpdir(), "opencode");

/** A fresh temp directory under `/tmp/opencode`, removed by the returned cleanup. */
export function tempDir(): { readonly path: string; readonly cleanup: () => void } {
    mkdirSync(BASE, { recursive: true });
    const path = mkdtempSync(join(BASE, "bashlight-cli-"));
    return { path, cleanup: () => rmSync(path, { recursive: true, force: true }) };
}
