/* eslint-disable sonarjs/function-return-type -- readers return undefined when a file is absent */
/**
 * The benchmark's projects and their tasks.
 *
 * Each entry pairs a committed template under `bench/projects/<name>/` with the
 * prompt the agent receives and a checker that decides success from the
 * project's own commands plus a few declaration checks. The prompts describe
 * the *goal*, never the toolchain, so whether bashlight rewrites the agent's
 * commands is left to the model. Several projects are multi-step and
 * multi-toolchain on purpose: the friction (wrong manager, wrong working
 * directory, wrong interpreter) is what the benchmark measures.
 */

import type { CommandResult } from "./lib/command.ts";
import type { BenchFileSystem } from "./lib/fs.ts";
import type { CommandSpec } from "./lib/template.ts";
import type { CheckResult } from "./lib/types.ts";

/** What a checker may use: the copy on disk and a way to run commands. */
export interface CheckContext {
    readonly projectDirectory: string;
    readonly fs: BenchFileSystem;
    /** Runs a command in the project copy with the run's isolated env. */
    readonly run: (spec: CommandSpec) => Promise<CommandResult>;
}

export interface TaskDefinition {
    readonly project: string;
    readonly prompt: string;
    /** Install steps run once per copy, in order, at the project root or a subdir. */
    readonly install: readonly CommandSpec[];
    readonly check: (context: CheckContext) => CheckResult | Promise<CheckResult>;
}

/** A command spec with an optional working directory. */
function command(
    executable: string,
    args: readonly string[],
    cwd?: string,
): CommandSpec {
    return cwd === undefined
        ? { command: executable, args }
        : { command: executable, args, cwd };
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

/** Whether a TOML section mentions a package, ignoring case and separators. */
function sectionDeclares(section: string, name: string): boolean {
    const normalise = (value: string) => value.toLowerCase().replaceAll(/[_.]/g, "-");
    return normalise(section).includes(normalise(name));
}

/** Directories a checker never needs to walk into. */
const IGNORED_DIRECTORIES = new Set([
    ".git",
    ".venv",
    "venv",
    "node_modules",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
]);

/** Recursively collects file paths under `directory` matching `wanted`. */
function walkFiles(
    fs: BenchFileSystem,
    directory: string,
    wanted: (path: string) => boolean,
): readonly string[] {
    const found: string[] = [];
    for (const entry of fs.readDirectory(directory)) {
        if (IGNORED_DIRECTORIES.has(entry)) {
            continue;
        }
        const path = `${directory}/${entry}`;
        if (fs.isDirectory(path)) {
            found.push(...walkFiles(fs, path, wanted));
        } else if (wanted(path)) {
            found.push(path);
        }
    }
    return found;
}

/** Whether any file under `directory` matching `wanted` contains `needle`. */
function anyFileContains(
    fs: BenchFileSystem,
    directory: string,
    wanted: (path: string) => boolean,
    needle: string,
): boolean {
    return walkFiles(fs, directory, wanted).some((path) =>
        (fs.readFile(path) ?? "").includes(needle),
    );
}

/** Reads a JSON file, or `undefined` when it is missing or malformed. */
function readJson(
    fs: BenchFileSystem,
    path: string,
): Record<string, unknown> | undefined {
    const text = fs.readFile(path);
    if (text === undefined) {
        return undefined;
    }
    try {
        const parsed: unknown = JSON.parse(text);
        return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : undefined;
    } catch {
        return undefined;
    }
}

/** Whether a package.json declares a dependency. */
function packageDeclares(manifest: Record<string, unknown>, name: string): boolean {
    for (const field of ["dependencies", "devDependencies"]) {
        const group = manifest[field];
        if (
            typeof group === "object" &&
            group !== null &&
            !Array.isArray(group) &&
            name in group
        ) {
            return true;
        }
    }
    return false;
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

/** Splits one CSV line, honouring double-quoted fields. */
function splitCsvLine(line: string): string[] {
    const cells: string[] = [];
    let current = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
        const character = line[index] ?? "";
        if (quoted) {
            if (character === '"') {
                if (line[index + 1] === '"') {
                    current += '"';
                    index += 1;
                } else {
                    quoted = false;
                }
            } else {
                current += character;
            }
        } else if (character === '"') {
            quoted = true;
        } else if (character === ",") {
            cells.push(current);
            current = "";
        } else {
            current += character;
        }
    }
    cells.push(current);
    return cells;
}

/** Parses a small CSV document into header-keyed records. */
export function parseCsv(text: string): readonly Record<string, string>[] {
    const lines = text
        .trim()
        .split(/\r?\n/)
        .filter((line) => line.trim() !== "");
    const header =
        lines[0] === undefined ? [] : splitCsvLine(lines[0]).map((h) => h.trim());
    return lines.slice(1).map((line) => {
        const cells = splitCsvLine(line);
        const record: Record<string, string> = {};
        header.forEach((key, index) => {
            record[key] = (cells[index] ?? "").trim();
        });
        return record;
    });
}

/** The expected records of `scripts/data.yaml`, in order. */
const INVENTORY_ROWS: readonly Record<string, string>[] = [
    { name: "Ada", role: "admin" },
    { name: "Grace", role: "editor" },
    { name: "Linus", role: "maintainer" },
];

const monorepo: TaskDefinition = {
    project: "monorepo",
    prompt:
        "This repository has a Python API under `api/` and a web client under `web/`. " +
        "Add an `endpoint_path(name)` helper to the API (`api/api/routes.py`) that turns " +
        "a route name into a URL path using the python-slugify library, and a matching " +
        "`parseEndpoint(payload)` helper to the web client (`web/src/client.ts`) that " +
        "validates an endpoint response using the zod library. Write tests for both " +
        "helpers and make sure both test suites pass.",
    install: [
        command("poetry", ["install", "--no-interaction"], "api"),
        command("pnpm", ["install", "--frozen-lockfile"], "web"),
    ],
    async check(context) {
        const api = await context.run(
            command("poetry", ["run", "pytest", "-q"], "api"),
        );
        if (api.code !== 0) {
            return failed("the API test suite did not pass", api);
        }
        const web = await context.run(command("pnpm", ["test"], "web"));
        if (web.code !== 0) {
            return failed("the web test suite did not pass", web);
        }
        const pyproject = context.fs.readFile(
            `${context.projectDirectory}/api/pyproject.toml`,
        );
        if (
            pyproject === undefined ||
            !sectionDeclares(
                tomlSection(pyproject, "[tool.poetry.dependencies]"),
                "python-slugify",
            )
        ) {
            return failed("python-slugify is not declared in the API pyproject.toml");
        }
        const manifest = readJson(
            context.fs,
            `${context.projectDirectory}/web/package.json`,
        );
        if (manifest === undefined || !packageDeclares(manifest, "zod")) {
            return failed("zod is not declared in web/package.json");
        }
        if (
            !anyFileContains(
                context.fs,
                `${context.projectDirectory}/api/tests`,
                (path) => path.endsWith(".py"),
                "endpoint",
            )
        ) {
            return failed("no API test references the endpoint helper");
        }
        if (
            !anyFileContains(
                context.fs,
                `${context.projectDirectory}/web/tests`,
                (path) => path.endsWith(".ts"),
                "parseEndpoint",
            )
        ) {
            return failed("no web test references parseEndpoint");
        }
        return {
            success: true,
            detail: "both suites pass and both dependencies are declared",
        };
    },
};

const uvCli: TaskDefinition = {
    project: "uv-cli",
    prompt:
        "Add two subcommands to this command line tool: `table` renders the rows in " +
        "`data.csv` as a text table, and `config` prints the values from " +
        "`config.yaml`. Add tests for both and make sure the test suite, Ruff and " +
        "mypy all pass.",
    install: [command("uv", ["sync", "--no-progress"])],
    async check(context) {
        const tests = await context.run(command("uv", ["run", "pytest", "-q"]));
        if (tests.code !== 0) {
            return failed("pytest did not pass", tests);
        }
        const lint = await context.run(command("uv", ["run", "ruff", "check"]));
        if (lint.code !== 0) {
            return failed("ruff check did not pass", lint);
        }
        const types = await context.run(command("uv", ["run", "mypy"]));
        if (types.code !== 0) {
            return failed("mypy did not pass", types);
        }
        const pyproject = context.fs.readFile(
            `${context.projectDirectory}/pyproject.toml`,
        );
        if (pyproject === undefined) {
            return failed("pyproject.toml is missing");
        }
        const project = tomlSection(pyproject, "[project]");
        for (const name of ["tabulate", "pyyaml"]) {
            if (!sectionDeclares(project, name)) {
                return failed(`${name} is not declared in the [project] dependencies`);
            }
        }
        return {
            success: true,
            detail: "tests, ruff and mypy pass; both libraries declared",
        };
    },
};

const poetryDjangoLite: TaskDefinition = {
    project: "poetry-django-lite",
    prompt:
        "This project has an executable `./manage.py` that exposes a few " +
        "management-style commands. Add a `report` command that reads " +
        "`data/inventory.yaml` with the PyYAML library and writes the inventory to " +
        "`out/inventory.csv`. Cover it with tests, make the test suite pass, and run " +
        "the command so the output file exists.",
    install: [command("poetry", ["install", "--no-interaction"])],
    async check(context) {
        const tests = await context.run(command("poetry", ["run", "pytest", "-q"]));
        if (tests.code !== 0) {
            return failed("the test suite did not pass", tests);
        }
        const pyproject = context.fs.readFile(
            `${context.projectDirectory}/pyproject.toml`,
        );
        if (
            pyproject === undefined ||
            !sectionDeclares(
                tomlSection(pyproject, "[tool.poetry.dependencies]"),
                "pyyaml",
            )
        ) {
            return failed("pyyaml is not declared in pyproject.toml");
        }
        if (
            !anyFileContains(
                context.fs,
                `${context.projectDirectory}/tests`,
                (path) => path.endsWith(".py"),
                "report",
            )
        ) {
            return failed("no test references the report command");
        }
        const run = await context.run(
            command("poetry", ["run", "./manage.py", "report"]),
        );
        if (run.code !== 0) {
            return failed("./manage.py report did not succeed", run);
        }
        const output = context.fs.readFile(
            `${context.projectDirectory}/out/inventory.csv`,
        );
        if (output === undefined) {
            return failed("out/inventory.csv was not produced");
        }
        const rows = parseCsv(output);
        const names = rows.map((row) => row.name ?? "");
        if (
            rows.length !== 2 ||
            !names.some((name) => name === "Widget") ||
            !names.some((name) => name === "Gadget")
        ) {
            return failed(
                `out/inventory.csv has unexpected rows: ${JSON.stringify(rows)}`,
            );
        }
        return {
            success: true,
            detail: "tests pass, pyyaml declared, report produced the CSV",
        };
    },
};

const scripts: TaskDefinition = {
    project: "scripts",
    prompt:
        "Convert `data.yaml` into `data.csv`. Write a Python script that reads the " +
        "YAML and writes the CSV, run it so `data.csv` exists, and keep the script in " +
        "the repository.",
    install: [],
    check(context) {
        const output = context.fs.readFile(`${context.projectDirectory}/data.csv`);
        if (output === undefined) {
            return failed("data.csv was not produced");
        }
        const rows = parseCsv(output);
        if (rows.length !== INVENTORY_ROWS.length) {
            return failed(
                `data.csv has ${rows.length} rows, expected ${INVENTORY_ROWS.length}`,
            );
        }
        for (let index = 0; index < INVENTORY_ROWS.length; index += 1) {
            const expected = INVENTORY_ROWS[index];
            const actual = rows[index];
            if (
                expected === undefined ||
                actual === undefined ||
                actual.name !== expected.name ||
                actual.role !== expected.role
            ) {
                return failed(`data.csv row ${index + 1} does not match data.yaml`);
            }
        }
        const scriptFound = anyFileContains(
            context.fs,
            context.projectDirectory,
            (path) => path.endsWith(".py"),
            "yaml",
        );
        if (!scriptFound) {
            return failed("no Python script referencing yaml was kept");
        }
        return {
            success: true,
            detail: "data.csv matches data.yaml and the script is present",
        };
    },
};

const pnpmWeb: TaskDefinition = {
    project: "pnpm-web",
    prompt:
        "Add two utilities to this web package: `formatRelative(date, now)` in " +
        "`src/time.ts`, which formats how long ago a date was relative to `now` using " +
        "dayjs and its relativeTime plugin, and `parseItem(payload)` in " +
        "`src/schema.ts`, which validates an item object with zod. Add vitest tests " +
        "for both and make sure the tests, the type checker and the linter all pass.",
    install: [command("pnpm", ["install", "--frozen-lockfile"])],
    async check(context) {
        const tests = await context.run(command("pnpm", ["test"]));
        if (tests.code !== 0) {
            return failed("pnpm test did not pass", tests);
        }
        const types = await context.run(command("pnpm", ["exec", "tsc", "--noEmit"]));
        if (types.code !== 0) {
            return failed("tsc --noEmit did not pass", types);
        }
        const lint = await context.run(command("pnpm", ["exec", "eslint", "."]));
        if (lint.code !== 0) {
            return failed("eslint did not pass", lint);
        }
        const manifest = readJson(
            context.fs,
            `${context.projectDirectory}/package.json`,
        );
        if (manifest === undefined) {
            return failed("package.json is missing");
        }
        for (const name of ["dayjs", "zod"]) {
            if (!packageDeclares(manifest, name)) {
                return failed(`${name} is not declared in package.json`);
            }
        }
        const stray = ["package-lock.json", "yarn.lock"].filter((name) =>
            context.fs.exists(`${context.projectDirectory}/${name}`),
        );
        if (stray.length > 0) {
            return failed(`unexpected lockfile(s): ${stray.join(", ")}`);
        }
        return {
            success: true,
            detail: "tests, types and lint pass; dayjs and zod declared",
        };
    },
};

/** Every task, in a stable order. */
export const TASKS: readonly TaskDefinition[] = [
    monorepo,
    uvCli,
    poetryDjangoLite,
    scripts,
    pnpmWeb,
];

/** The task for a project name, or `undefined` when unknown. */
export function taskFor(project: string): TaskDefinition | undefined {
    return TASKS.find((task) => task.project === project);
}
