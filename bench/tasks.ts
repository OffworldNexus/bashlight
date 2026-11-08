/**
 * The benchmark's projects and their tasks.
 *
 * Each entry pairs a committed template under `bench/projects/<name>/` with the
 * prompt the agent receives and a checker that decides success from the
 * project's own test command plus a few declaration checks. The task texts
 * deliberately describe the *goal*, not the command, so whether bashlight
 * rewrites the agent's package-manager command is left to the model.
 */

import type { CommandResult } from "./lib/command.ts";
import type { BenchFileSystem } from "./lib/fs.ts";
import type { CommandSpec } from "./lib/template.ts";
import type { CheckResult } from "./lib/types.ts";

/** What a checker may use: the copy on disk and a way to run the tests. */
export interface CheckContext {
    readonly projectDirectory: string;
    readonly fs: BenchFileSystem;
    /** Runs a command in the project copy with the run's isolated env. */
    readonly run: (spec: CommandSpec) => Promise<CommandResult>;
}

export interface TaskDefinition {
    readonly project: string;
    readonly prompt: string;
    readonly install: CommandSpec;
    readonly test: CommandSpec;
    readonly check: (context: CheckContext) => Promise<CheckResult>;
}

/** The lines of a `[section]` in a TOML document, up to the next header. */
function tomlSection(text: string, header: string): string {
    const lines = text.split("\n");
    const start = lines.findIndex((line) => line.trim() === header);
    if (start === -1) {
        return "";
    }
    const body: string[] = [];
    for (let index = start + 1; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        if (/^\s*\[/.test(line)) {
            break;
        }
        body.push(line);
    }
    return body.join("\n");
}

/** Recursively collects file paths under `directory` matching `wanted`. */
function walkFiles(
    fs: BenchFileSystem,
    directory: string,
    wanted: (path: string) => boolean,
): readonly string[] {
    const found: string[] = [];
    for (const entry of fs.readDirectory(directory)) {
        const path = `${directory}/${entry}`;
        if (fs.isDirectory(path)) {
            found.push(...walkFiles(fs, path, wanted));
        } else if (wanted(path)) {
            found.push(path);
        }
    }
    return found;
}

/** Reports a failed check with the command output for context. */
function failed(detail: string, result?: CommandResult): CheckResult {
    if (result === undefined) {
        return { success: false, detail };
    }
    const tail = `${result.stdout}\n${result.stderr}`
        .trim()
        .split("\n")
        .slice(-8)
        .join("\n");
    return { success: false, detail: `${detail}\n${tail}` };
}

const poetryShop: TaskDefinition = {
    project: "poetry-shop",
    prompt:
        "Add a `slugify_title(title)` function to `shop/text.py` that turns a " +
        "title into a URL slug using the python-slugify library. Cover it with " +
        "tests in the `tests/` directory and make sure the whole test suite " +
        "passes with the project's test command.",
    install: { command: "poetry", args: ["install", "--no-interaction"] },
    test: { command: "poetry", args: ["run", "pytest", "-q"] },
    async check(context) {
        const result = await context.run(poetryShop.test);
        if (result.code !== 0) {
            return failed("poetry run pytest did not pass", result);
        }
        const pyproject = context.fs.readFile(
            `${context.projectDirectory}/pyproject.toml`,
        );
        if (pyproject === undefined) {
            return failed("pyproject.toml is missing");
        }
        const dependencies = tomlSection(pyproject, "[tool.poetry.dependencies]");
        if (!dependencies.includes("python-slugify")) {
            return failed(
                "python-slugify is not declared in [tool.poetry.dependencies]",
            );
        }
        const tests = walkFiles(
            context.fs,
            `${context.projectDirectory}/tests`,
            (path) => path.endsWith(".py"),
        );
        const mentioned = tests.some((path) =>
            (context.fs.readFile(path) ?? "").includes("slugify_title"),
        );
        if (!mentioned) {
            return failed("no test references slugify_title");
        }
        return { success: true, detail: "tests pass and python-slugify is declared" };
    },
};

const uvReport: TaskDefinition = {
    project: "uv-report",
    prompt:
        "Add a `report` command to the command line interface that prints the " +
        "data in `data.csv` as a table using the tabulate library, and add a " +
        "test for it. Make sure the test suite passes with the project's test " +
        "command.",
    install: { command: "uv", args: ["sync", "--no-progress"] },
    test: { command: "uv", args: ["run", "pytest", "-q"] },
    async check(context) {
        const result = await context.run(uvReport.test);
        if (result.code !== 0) {
            return failed("uv run pytest did not pass", result);
        }
        const pyproject = context.fs.readFile(
            `${context.projectDirectory}/pyproject.toml`,
        );
        if (pyproject === undefined) {
            return failed("pyproject.toml is missing");
        }
        const project = tomlSection(pyproject, "[project]");
        if (!project.includes("tabulate")) {
            return failed("tabulate is not declared in the [project] dependencies");
        }
        return { success: true, detail: "tests pass and tabulate is declared" };
    },
};

const pnpmWeb: TaskDefinition = {
    project: "pnpm-web",
    prompt:
        "Add a `formatRelative(date, now)` utility to `src/time.ts` that " +
        "formats how long ago a date was relative to `now`, using dayjs and " +
        "its relativeTime plugin. Add vitest tests and make sure `pnpm test` " +
        "passes.",
    install: { command: "pnpm", args: ["install", "--frozen-lockfile"] },
    test: { command: "pnpm", args: ["test"] },
    async check(context) {
        const result = await context.run(pnpmWeb.test);
        if (result.code !== 0) {
            return failed("pnpm test did not pass", result);
        }
        const manifest = context.fs.readFile(
            `${context.projectDirectory}/package.json`,
        );
        if (manifest === undefined) {
            return failed("package.json is missing");
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(manifest);
        } catch {
            return failed("package.json is not valid JSON");
        }
        const pkg = parsed as {
            dependencies?: Record<string, string>;
            devDependencies?: Record<string, string>;
        };
        const declared =
            pkg.dependencies?.dayjs !== undefined ||
            pkg.devDependencies?.dayjs !== undefined;
        if (!declared) {
            return failed("dayjs is not declared in package.json");
        }
        const stray = ["package-lock.json", "yarn.lock"].filter((name) =>
            context.fs.exists(`${context.projectDirectory}/${name}`),
        );
        if (stray.length > 0) {
            return failed(`unexpected lockfile(s): ${stray.join(", ")}`);
        }
        return { success: true, detail: "tests pass and dayjs is declared" };
    },
};

/** Every task, in a stable order. */
export const TASKS: readonly TaskDefinition[] = [poetryShop, uvReport, pnpmWeb];

/** The task for a project name, or `undefined` when unknown. */
export function taskFor(project: string): TaskDefinition | undefined {
    return TASKS.find((task) => task.project === project);
}
