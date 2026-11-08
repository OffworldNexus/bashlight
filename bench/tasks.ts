/* eslint-disable sonarjs/function-return-type -- readers return undefined when a file is absent */
/**
 * The benchmark's projects and their tasks.
 *
 * A prompt states the whole spec: the libraries a feature must use, the
 * function and file names, the commands and output files, and the checks that
 * must pass. It never states *how* to reach them — no package manager, runner
 * or interpreter is named, so discovering the toolchain (and whether bashlight
 * rewrites the commands) is left to the model.
 *
 * Each checker collects **every** failing condition, not just the first, so a
 * failed run is easy to analyse.
 */

import type { CommandResult } from "./lib/command.ts";
import { type BenchFileSystem, walkFiles } from "./lib/fs.ts";
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

/** One failing condition, with the output of the command that failed. */
interface Failure {
    readonly message: string;
    readonly output?: string;
}

/** The last lines of a command's output, for the failure detail. */
function outputTail(result: CommandResult): string {
    return `${result.stdout}\n${result.stderr}`.trim().split("\n").slice(-8).join("\n");
}

/** Turns the collected failures into a {@link CheckResult}, or success. */
function verdict(failures: readonly Failure[], successDetail: string): CheckResult {
    if (failures.length === 0) {
        return { success: true, detail: successDetail };
    }
    const lines = failures.flatMap((failure) =>
        failure.output === undefined || failure.output === ""
            ? [failure.message]
            : [
                  failure.message,
                  ...failure.output.split("\n").map((line) => `    ${line}`),
              ],
    );
    return { success: false, detail: lines.join("\n") };
}

/** Whether a manifest mentions a package, ignoring case and separators. */
function declares(text: string, name: string): boolean {
    const normalise = (value: string) => value.toLowerCase().replaceAll(/[_.]/g, "-");
    return normalise(text).includes(normalise(name));
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

/** Whether a path looks like a Python test. */
function isPythonTest(path: string): boolean {
    const name = path.split("/").pop() ?? "";
    return (
        path.includes("/tests/") ||
        name.startsWith("test_") ||
        name.endsWith("_test.py")
    );
}

/** Whether a path looks like a TypeScript test. */
function isTypeScriptTest(path: string): boolean {
    return (
        path.includes("/tests/") ||
        path.endsWith(".test.ts") ||
        path.endsWith(".spec.ts")
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

/** Whether a package.json declares a dependency (runtime or dev). */
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

/** The header cells of a CSV document, lower-cased. */
function csvHeader(text: string): readonly string[] {
    const first = text.trim().split(/\r?\n/)[0] ?? "";
    return splitCsvLine(first).map((cell) => cell.trim().toLowerCase());
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
        "Add an `endpoint_path(name)` helper to `api/api/routes.py` that turns a route " +
        "name into a URL path using the python-slugify library, and a `parseEndpoint(payload)` " +
        "helper to `web/src/client.ts` that validates an endpoint response using the zod " +
        "library. Write tests for both helpers and make sure both test suites pass.",
    install: [
        command("poetry", ["install", "--no-interaction"], "api"),
        command("pnpm", ["install", "--frozen-lockfile"], "web"),
    ],
    async check(context) {
        const failures: Failure[] = [];
        const api = await context.run(
            command("poetry", ["run", "pytest", "-q"], "api"),
        );
        if (api.code !== 0) {
            failures.push({
                message: "the API test suite did not pass",
                output: outputTail(api),
            });
        }
        const web = await context.run(command("pnpm", ["test"], "web"));
        if (web.code !== 0) {
            failures.push({
                message: "the web test suite did not pass",
                output: outputTail(web),
            });
        }
        const pyproject = context.fs.readFile(
            `${context.projectDirectory}/api/pyproject.toml`,
        );
        if (pyproject === undefined || !declares(pyproject, "python-slugify")) {
            failures.push({
                message: "python-slugify is not declared in api/pyproject.toml",
            });
        }
        const manifest = readJson(
            context.fs,
            `${context.projectDirectory}/web/package.json`,
        );
        if (manifest === undefined || !packageDeclares(manifest, "zod")) {
            failures.push({ message: "zod is not declared in web/package.json" });
        }
        if (
            !anyFileContains(
                context.fs,
                `${context.projectDirectory}/api`,
                (path) => path.endsWith(".py") && isPythonTest(path),
                "endpoint_path",
            )
        ) {
            failures.push({ message: "no API test references endpoint_path" });
        }
        if (
            !anyFileContains(
                context.fs,
                `${context.projectDirectory}/web`,
                (path) => path.endsWith(".ts") && isTypeScriptTest(path),
                "parseEndpoint",
            )
        ) {
            failures.push({ message: "no web test references parseEndpoint" });
        }
        return verdict(failures, "both suites pass and both dependencies are declared");
    },
};

const uvCli: TaskDefinition = {
    project: "uv-cli",
    prompt:
        "This repository is a small command line tool. Add two subcommands: `table`, " +
        "which renders the rows in `data.csv` as a text table using the tabulate " +
        "library, and `config`, which prints the values from `config.yaml` using the " +
        "PyYAML library. Add tests for both, and make the test suite, Ruff and mypy " +
        "all pass.",
    install: [command("uv", ["sync", "--no-progress"])],
    async check(context) {
        const failures: Failure[] = [];
        const tests = await context.run(command("uv", ["run", "pytest", "-q"]));
        if (tests.code !== 0) {
            failures.push({
                message: "pytest did not pass",
                output: outputTail(tests),
            });
        }
        const lint = await context.run(command("uv", ["run", "ruff", "check"]));
        if (lint.code !== 0) {
            failures.push({
                message: "ruff check did not pass",
                output: outputTail(lint),
            });
        }
        const types = await context.run(command("uv", ["run", "mypy"]));
        if (types.code !== 0) {
            failures.push({ message: "mypy did not pass", output: outputTail(types) });
        }
        const table = await context.run(
            command("uv", ["run", "python", "-m", "uvcli.cli", "table"]),
        );
        if (table.code !== 0 || !table.stdout.toLowerCase().includes("widget")) {
            failures.push({
                message: "`table` did not print the rows in data.csv",
                output: outputTail(table),
            });
        }
        const config = await context.run(
            command("uv", ["run", "python", "-m", "uvcli.cli", "config"]),
        );
        if (config.code !== 0 || !config.stdout.toLowerCase().includes("retries")) {
            failures.push({
                message: "`config` did not print the values in config.yaml",
                output: outputTail(config),
            });
        }
        const pyproject = context.fs.readFile(
            `${context.projectDirectory}/pyproject.toml`,
        );
        if (pyproject === undefined) {
            failures.push({ message: "pyproject.toml is missing" });
        } else {
            for (const name of ["tabulate", "pyyaml"]) {
                if (!declares(pyproject, name)) {
                    failures.push({
                        message: `${name} is not declared in pyproject.toml`,
                    });
                }
            }
        }
        return verdict(failures, "tests, ruff and mypy pass; both libraries declared");
    },
};

const poetryDjangoLite: TaskDefinition = {
    project: "poetry-django-lite",
    prompt:
        "This project has an executable `./manage.py` that exposes a few " +
        "management-style commands. Add a `report` command that reads " +
        "`data/inventory.yaml` with the PyYAML library and writes the inventory to " +
        "`out/inventory.csv` as a CSV with a header row and one row per item, keeping " +
        "the `sku`, `name` and `qty` fields. Cover the command with tests, make the " +
        "test suite pass, and run `./manage.py report` so the output file exists.",
    install: [command("poetry", ["install", "--no-interaction"])],
    async check(context) {
        const failures: Failure[] = [];
        const tests = await context.run(command("poetry", ["run", "pytest", "-q"]));
        if (tests.code !== 0) {
            failures.push({
                message: "the test suite did not pass",
                output: outputTail(tests),
            });
        }
        const pyproject = context.fs.readFile(
            `${context.projectDirectory}/pyproject.toml`,
        );
        if (pyproject === undefined || !declares(pyproject, "pyyaml")) {
            failures.push({ message: "pyyaml is not declared in pyproject.toml" });
        }
        if (
            !anyFileContains(
                context.fs,
                context.projectDirectory,
                (path) => path.endsWith(".py") && isPythonTest(path),
                "report",
            )
        ) {
            failures.push({ message: "no test references the report command" });
        }
        const run = await context.run(
            command("poetry", ["run", "./manage.py", "report"]),
        );
        if (run.code !== 0) {
            failures.push({
                message: "./manage.py report did not succeed",
                output: outputTail(run),
            });
        }
        const output = context.fs.readFile(
            `${context.projectDirectory}/out/inventory.csv`,
        );
        if (output === undefined) {
            failures.push({ message: "out/inventory.csv was not produced" });
        } else {
            const header = csvHeader(output);
            for (const field of ["sku", "name", "qty"]) {
                if (!header.includes(field)) {
                    failures.push({
                        message: `out/inventory.csv has no '${field}' column (header: ${header.join(", ")})`,
                    });
                }
            }
            const rows = parseCsv(output);
            const names = rows.map((row) => row.name ?? "");
            if (
                rows.length !== 2 ||
                !names.some((name) => name === "Widget") ||
                !names.some((name) => name === "Gadget")
            ) {
                failures.push({
                    message: `out/inventory.csv has unexpected rows: ${JSON.stringify(rows)}`,
                });
            }
        }
        return verdict(
            failures,
            "tests pass, pyyaml declared, report produced the CSV",
        );
    },
};

const scripts: TaskDefinition = {
    project: "scripts",
    prompt:
        "Convert `data.yaml` into `data.csv` using the PyYAML library: write a Python " +
        "script that reads the YAML file and writes a CSV with a header row and one row " +
        "per entry, keeping its `name` and `role` fields. Run the script so `data.csv` " +
        "exists, and keep the script in the repository.",
    install: [],
    check(context) {
        const failures: Failure[] = [];
        const output = context.fs.readFile(`${context.projectDirectory}/data.csv`);
        if (output === undefined) {
            failures.push({ message: "data.csv was not produced" });
        } else {
            const rows = parseCsv(output);
            if (rows.length !== INVENTORY_ROWS.length) {
                failures.push({
                    message: `data.csv has ${rows.length} rows, expected ${INVENTORY_ROWS.length}`,
                });
            } else {
                for (let index = 0; index < INVENTORY_ROWS.length; index += 1) {
                    const expected = INVENTORY_ROWS[index];
                    const actual = rows[index];
                    if (
                        expected === undefined ||
                        actual === undefined ||
                        actual.name !== expected.name ||
                        actual.role !== expected.role
                    ) {
                        failures.push({
                            message: `data.csv row ${index + 1} does not match data.yaml`,
                        });
                    }
                }
            }
        }
        if (
            !anyFileContains(
                context.fs,
                context.projectDirectory,
                (path) => path.endsWith(".py"),
                "yaml",
            )
        ) {
            failures.push({ message: "no Python script using yaml was kept" });
        }
        return verdict(
            failures,
            "data.csv matches data.yaml and the script is present",
        );
    },
};

const pnpmWeb: TaskDefinition = {
    project: "pnpm-web",
    prompt:
        "Add two utilities to this web package: `formatRelative(date, now)` in " +
        "`src/time.ts`, which returns how long ago a date was relative to `now` using " +
        "dayjs and its relativeTime plugin, and `parseItem(payload)` in `src/schema.ts`, " +
        "which validates an item object using zod. Add vitest tests for both, and make " +
        "the tests, the type checker and the linter all pass.",
    install: [command("pnpm", ["install", "--frozen-lockfile"])],
    async check(context) {
        const failures: Failure[] = [];
        const tests = await context.run(command("pnpm", ["test"]));
        if (tests.code !== 0) {
            failures.push({
                message: "pnpm test did not pass",
                output: outputTail(tests),
            });
        }
        const types = await context.run(command("pnpm", ["exec", "tsc", "--noEmit"]));
        if (types.code !== 0) {
            failures.push({
                message: "tsc --noEmit did not pass",
                output: outputTail(types),
            });
        }
        const lint = await context.run(command("pnpm", ["exec", "eslint", "."]));
        if (lint.code !== 0) {
            failures.push({ message: "eslint did not pass", output: outputTail(lint) });
        }
        const manifest = readJson(
            context.fs,
            `${context.projectDirectory}/package.json`,
        );
        if (manifest === undefined) {
            failures.push({ message: "package.json is missing" });
        } else {
            for (const name of ["dayjs", "zod"]) {
                if (!packageDeclares(manifest, name)) {
                    failures.push({
                        message: `${name} is not declared in package.json`,
                    });
                }
            }
        }
        return verdict(failures, "tests, types and lint pass; dayjs and zod declared");
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
