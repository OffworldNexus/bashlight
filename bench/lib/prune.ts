/* eslint-disable sonarjs/cognitive-complexity -- a flat event switch */
/**
 * Pruning a finished run down to small, analysis-friendly artefacts.
 *
 * A working copy is large: `.venv` / `node_modules`, the per-run XDG cache and
 * the OpenCode session database add up to tens of megabytes per run, and a long
 * matrix fills the (often tmpfs) run root. After the metrics and the checks are
 * extracted, {@link RunPruner} keeps only the small files worth analysing — a
 * compact tool-call transcript, the bashlight audit log, the OpenCode log, the
 * checker output and a capped diff of the copy against the template — inside
 * `bench/runs/<id>/`, then deletes the working directory.
 *
 * With `--keep-runs` the working directory is left in place.
 */

import { type BenchFileSystem, walkFiles } from "./fs.ts";

/** The default cap on the total bytes of file contents kept in a diff. */
export const DEFAULT_MAX_DIFF_BYTES = 200 * 1024;

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function asString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

/**
 * Collapses the `opencode run --format json` event stream into one compact
 * JSON line per assistant text, tool call and error. This is the transcript we
 * keep; the raw stream and the session database are not.
 */
export function transcriptFromEvents(eventsText: string): string {
    const lines: string[] = [];
    for (const raw of eventsText.split("\n")) {
        const trimmed = raw.trim();
        if (trimmed === "") {
            continue;
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(trimmed);
        } catch {
            continue;
        }
        const event = asRecord(parsed);
        if (event === undefined) {
            continue;
        }
        const type = asString(event.type);
        if (type === "text") {
            const text = asString(asRecord(event.part)?.text);
            if (text !== undefined && text !== "") {
                lines.push(JSON.stringify({ type: "text", text }));
            }
        } else if (type === "tool_use") {
            const part = asRecord(event.part);
            const state = asRecord(part?.state);
            const error = asString(state?.error);
            lines.push(
                JSON.stringify({
                    type: "tool",
                    tool: asString(part?.tool) ?? "unknown",
                    status: asString(state?.status) ?? "unknown",
                    input: asRecord(state?.input) ?? {},
                    ...(error === undefined ? {} : { error }),
                }),
            );
        } else if (type === "error") {
            lines.push(
                JSON.stringify({
                    type: "error",
                    message:
                        asString(asRecord(event.error)?.message) ?? "unknown error",
                }),
            );
        }
    }
    return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

/** How a project file changed relative to the template. */
export interface DiffEntry {
    readonly path: string;
    readonly status: "added" | "changed" | "removed";
    /** The file's content, when it fits the byte budget. */
    readonly content?: string;
    /** Set when the content was left out to respect the byte budget. */
    readonly contentOmitted?: boolean;
}

/** Reads a tree into a map of relative path → text content. */
function readTree(fs: BenchFileSystem, directory: string): Map<string, string> {
    const files = new Map<string, string>();
    for (const absolute of walkFiles(fs, directory, () => true)) {
        const relative = absolute.slice(directory.length + 1);
        files.set(relative, fs.readFile(absolute) ?? "");
    }
    return files;
}

/**
 * The diff of a project copy against its template: added, changed and removed
 * files, with contents kept until `maxBytes` is reached (paths are always
 * listed).
 */
export function projectDiff(
    fs: BenchFileSystem,
    templateDirectory: string,
    projectDirectory: string,
    maxBytes: number = DEFAULT_MAX_DIFF_BYTES,
): readonly DiffEntry[] {
    const template = readTree(fs, templateDirectory);
    const project = readTree(fs, projectDirectory);
    const paths = [...new Set([...template.keys(), ...project.keys()])].sort(
        (left, right) => left.localeCompare(right),
    );
    const entries: DiffEntry[] = [];
    let budget = maxBytes;
    const entry = (
        status: "added" | "changed",
        path: string,
        content: string,
    ): DiffEntry => {
        if (content.length <= budget) {
            budget -= content.length;
            return { path, status, content };
        }
        return { path, status, contentOmitted: true };
    };
    for (const path of paths) {
        const before = template.get(path);
        const after = project.get(path);
        if (before === undefined && after !== undefined) {
            entries.push(entry("added", path, after));
        } else if (before !== undefined && after === undefined) {
            entries.push({ path, status: "removed" });
        } else if (before !== after && after !== undefined) {
            entries.push(entry("changed", path, after));
        }
    }
    return entries;
}

/** Everything the pruner needs to finish one run. */
export interface PruneInput {
    readonly runDirectory: string;
    readonly projectDirectory: string;
    readonly templateDirectory: string;
    readonly artifactsDirectory: string;
    readonly keepWorkingDirectory?: boolean;
}

/**
 * Writes the small artefacts for a run and (unless asked to keep it) deletes
 * the working directory.
 */
export class RunPruner {
    constructor(
        private readonly fs: BenchFileSystem,
        private readonly maxDiffBytes: number = DEFAULT_MAX_DIFF_BYTES,
    ) {}

    prune(input: PruneInput): void {
        this.writeTranscript(input.artifactsDirectory);
        this.writeOpenCodeLog(input.runDirectory, input.artifactsDirectory);
        this.writeDiff(
            input.templateDirectory,
            input.projectDirectory,
            input.artifactsDirectory,
        );
        if (input.keepWorkingDirectory !== true) {
            this.fs.remove(input.runDirectory);
        }
    }

    /** Derives the compact transcript from the captured event stream. */
    private writeTranscript(directory: string): void {
        const events = this.fs.readFile(`${directory}/events.jsonl`);
        if (events === undefined) {
            return;
        }
        this.fs.writeFile(
            `${directory}/transcript.jsonl`,
            transcriptFromEvents(events),
        );
    }

    /** Copies the OpenCode server log (the plugin-load / error trail). */
    private writeOpenCodeLog(runDirectory: string, directory: string): void {
        const logDirectory = `${runDirectory}/data/opencode/log`;
        const logs = this.fs
            .readDirectory(logDirectory)
            .filter((name) => name.endsWith(".log"))
            .sort((left, right) => left.localeCompare(right));
        const text = logs
            .map((name) => this.fs.readFile(`${logDirectory}/${name}`) ?? "")
            .join("");
        if (text !== "") {
            this.fs.writeFile(`${directory}/opencode.log`, text);
        }
    }

    /** Writes the project-vs-template diff. */
    private writeDiff(
        templateDirectory: string,
        projectDirectory: string,
        directory: string,
    ): void {
        const diff = projectDiff(
            this.fs,
            templateDirectory,
            projectDirectory,
            this.maxDiffBytes,
        );
        this.fs.writeFile(
            `${directory}/diff.json`,
            `${JSON.stringify(diff, null, 2)}\n`,
        );
    }
}
