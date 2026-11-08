/* eslint-disable sonarjs/cognitive-complexity */
/**
 * Builds a `MemoryFileSystem` from `corpus/projects.json`: each anonymized
 * project's markers are materialized as the files the project inspectors look
 * for (pyproject/lock files, a virtualenv interpreter, package.json, locks).
 *
 * The dependency lists are a plausible, fixed set rather than the real ones —
 * the corpus records which project a command ran in, not its manifests.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
    type FileSystemEntries,
    MemoryFileSystem,
} from "../../src/project/memory-file-system.ts";

const PROJECTS_PATH = fileURLToPath(
    new URL("../../corpus/projects.json", import.meta.url),
);
const COMMANDS_PATH = fileURLToPath(
    new URL("../../corpus/commands.jsonl", import.meta.url),
);

const PYTHON_PACKAGES = ["pytest", "mypy", "ruff", "black", "django", "alembic"];
const NODE_PACKAGES = ["vitest", "typescript", "tsx", "eslint", "prettier"];

interface PyprojectMarkers {
    readonly present?: boolean;
    readonly poetry?: boolean;
    readonly uv?: boolean;
    readonly project?: boolean;
    readonly buildSystem?: boolean;
    readonly buildBackend?: string;
}

interface NodeMarkers {
    readonly packageManager?: string;
    readonly packageLock?: boolean;
    readonly pnpmLock?: boolean;
    readonly bunLock?: boolean;
    readonly yarnLock?: boolean;
}

interface VenvMarkers {
    readonly dir?: string;
    readonly python?: boolean;
}

interface Markers {
    readonly pyproject?: PyprojectMarkers;
    readonly uvLock?: boolean;
    readonly poetryLock?: boolean;
    readonly pdmLock?: boolean;
    readonly venv?: VenvMarkers;
    readonly requirements?: readonly string[];
    readonly setupPy?: boolean;
    readonly managePy?: boolean;
    readonly makefile?: boolean;
    readonly git?: boolean;
    readonly node?: NodeMarkers;
    readonly pnpmWorkspace?: boolean;
}

interface ProjectRecord {
    readonly root: string;
    readonly markers: Markers;
}

export function loadProjects(): Record<string, ProjectRecord> {
    return JSON.parse(readFileSync(PROJECTS_PATH, "utf8")) as Record<
        string,
        ProjectRecord
    >;
}

export interface CorpusCommand {
    readonly id: string;
    readonly command: string;
    readonly cwd: string;
}

export function loadCommands(): CorpusCommand[] {
    const commands: CorpusCommand[] = [];
    for (const line of readFileSync(COMMANDS_PATH, "utf8").split("\n")) {
        if (line.trim() === "") {
            continue;
        }
        const parsed = JSON.parse(line) as {
            id?: unknown;
            command?: unknown;
            cwd?: unknown;
        };
        if (typeof parsed.command === "string") {
            commands.push({
                id: typeof parsed.id === "string" ? parsed.id : "?",
                command: parsed.command,
                cwd: typeof parsed.cwd === "string" ? parsed.cwd : "/",
            });
        }
    }
    return commands;
}

export class CorpusFixture {
    private readonly entries: FileSystemEntries;

    constructor(projects: Record<string, ProjectRecord> = loadProjects()) {
        this.entries = buildEntries(projects);
    }

    fileSystem(): MemoryFileSystem {
        return new MemoryFileSystem(this.entries);
    }
}

export function buildEntries(
    projects: Record<string, ProjectRecord>,
): FileSystemEntries {
    const entries: Record<string, string | null> = {};
    for (const project of Object.values(projects)) {
        addProject(entries, project.root, project.markers);
    }
    return entries;
}

function addProject(
    entries: Record<string, string | null>,
    root: string,
    markers: Markers,
): void {
    if (markers.pyproject !== undefined) {
        entries[`${root}/pyproject.toml`] = renderPyproject(markers.pyproject);
    }
    if (markers.poetryLock === true) {
        entries[`${root}/poetry.lock`] = "";
    }
    if (markers.uvLock === true) {
        entries[`${root}/uv.lock`] = "";
    }
    if (markers.pdmLock === true) {
        entries[`${root}/pdm.lock`] = "";
    }
    if (markers.venv?.python === true) {
        entries[`${root}/${markers.venv.dir ?? ".venv"}/bin/python`] = "";
    }
    for (const requirement of markers.requirements ?? []) {
        entries[`${root}/${requirement}`] = "";
    }
    if (markers.setupPy === true) {
        entries[`${root}/setup.py`] = "";
    }
    if (markers.managePy === true) {
        entries[`${root}/manage.py`] = "#!/usr/bin/env python3\n";
    }
    if (markers.makefile === true) {
        entries[`${root}/Makefile`] = "";
    }
    if (markers.git === true) {
        entries[`${root}/.git`] = null;
    }
    if (markers.node !== undefined) {
        entries[`${root}/package.json`] = renderPackageJson(markers.node);
        if (markers.node.packageLock === true) {
            entries[`${root}/package-lock.json`] = "";
        }
        if (markers.node.pnpmLock === true) {
            entries[`${root}/pnpm-lock.yaml`] = "";
        }
        if (markers.node.bunLock === true) {
            entries[`${root}/bun.lock`] = "";
        }
        if (markers.node.yarnLock === true) {
            entries[`${root}/yarn.lock`] = "";
        }
    }
    if (markers.pnpmWorkspace === true) {
        entries[`${root}/pnpm-workspace.yaml`] = "packages: []\n";
    }
}

function renderPyproject(markers: PyprojectMarkers): string {
    const lines: string[] = [];
    const quoted = PYTHON_PACKAGES.map((name) => `"${name}"`).join(", ");
    if (markers.poetry === true) {
        lines.push(
            "[tool.poetry]",
            'name = "app"',
            'version = "0.1.0"',
            "",
            "[tool.poetry.dependencies]",
            'python = "^3.12"',
            ...PYTHON_PACKAGES.map((name) => `${name} = "*"`),
            "",
        );
    }
    if (markers.project === true) {
        lines.push(
            "[project]",
            'name = "app"',
            'version = "0.1.0"',
            `dependencies = [${quoted}]`,
            "",
        );
    }
    if (markers.uv === true) {
        lines.push("[tool.uv]", `dev-dependencies = [${quoted}]`, "");
    }
    if (markers.buildSystem === true) {
        const backend = markers.buildBackend ?? "setuptools.build_meta";
        lines.push(
            "[build-system]",
            `requires = ["${backend}"]`,
            `build-backend = "${backend}"`,
            "",
        );
    }
    return `${lines.join("\n")}\n`;
}

function renderPackageJson(node: NodeMarkers): string {
    const pkg: Record<string, unknown> = {
        name: "app",
        version: "0.1.0",
        dependencies: { react: "^18.0.0" },
        devDependencies: Object.fromEntries(
            NODE_PACKAGES.map((name) => [name, "^1.0.0"]),
        ),
    };
    if (typeof node.packageManager === "string") {
        pkg["packageManager"] = node.packageManager;
    }
    return JSON.stringify(pkg, null, 2);
}
