import { join, nearestSelfOrAncestor } from "../shared/posix-path.ts";
import type { ToolchainDetector } from "./detector.ts";
import type { FileSystem } from "./file-system.ts";
import {
    PDM_LOCK,
    PIPFILE,
    PIPFILE_LOCK,
    POETRY_LOCK,
    PYPROJECT,
    PYTHON_PROJECT_FILES,
    UV_LOCK,
    VENV_DIRS,
    VENV_PYTHON_PATH,
} from "./manifests.ts";
import { PythonToolchainImpl } from "./python-toolchain.ts";
import { TomlDocument } from "./toml-reader.ts";
import type { PythonManager, PythonToolchain } from "./toolchain.ts";

/** A `[presence, manager]` pair used to pick the first matching manager. */
type ManagerCandidate = readonly [boolean, PythonManager];

/** A predicate marking the directory a manager considers its workspace root. */
type RootMarker = (dir: string) => boolean;

function firstPresent(
    candidates: readonly ManagerCandidate[],
): PythonManager | undefined {
    return candidates.find(([present]) => present)?.[1];
}

function hasSection(doc: TomlDocument | undefined, path: readonly string[]): boolean {
    return doc?.hasTable(path) ?? false;
}

/**
 * Finds the innermost Python project governing `dir` by walking up to the
 * filesystem root (never stopping at `$HOME`, which the inspector does not
 * know), then resolves its manager.
 *
 * Manager precedence inside the project root: lockfiles, then `pyproject`
 * sections, then a bare `.venv`/`venv` with `bin/python`. When both
 * `poetry.lock` and `uv.lock` exist the lock matching the pyproject `[tool.*]`
 * section wins, otherwise poetry. The effective `root` is the workspace root:
 * a `poetry.lock` at an ancestor, or a `[tool.uv.workspace]`/`uv.lock` at an
 * ancestor for uv.
 */
export class PythonToolchainDetector implements ToolchainDetector<PythonToolchain> {
    constructor(private readonly fs: FileSystem) {}

    detect(dir: string): PythonToolchain | undefined {
        const projectDir = this.findProjectDir(dir);
        return projectDir === undefined ? undefined : this.detectAt(projectDir);
    }

    private detectAt(projectDir: string): PythonToolchain | undefined {
        const pyproject = this.readPyproject(projectDir);
        const manager = this.resolveManager(projectDir, pyproject);
        return manager === undefined
            ? undefined
            : this.buildToolchain(projectDir, manager);
    }

    private buildToolchain(
        projectDir: string,
        manager: PythonManager,
    ): PythonToolchain {
        const root = this.resolveRoot(projectDir, manager);
        const venv =
            this.findVenv(root) ??
            (root === projectDir ? undefined : this.findVenv(projectDir));
        return new PythonToolchainImpl(this.fs, manager, root, venv);
    }

    private findProjectDir(dir: string): string | undefined {
        return nearestSelfOrAncestor(dir, (candidate) => this.hasMarker(candidate));
    }

    private hasMarker(dir: string): boolean {
        const hasFile = PYTHON_PROJECT_FILES.some((file) =>
            this.fs.exists(join(dir, file)),
        );
        const hasVenv = VENV_DIRS.some((venv) => this.fs.isDirectory(join(dir, venv)));
        return hasFile || hasVenv;
    }

    private readPyproject(dir: string): TomlDocument | undefined {
        const text = this.fs.readText(join(dir, PYPROJECT));
        return text === undefined ? undefined : TomlDocument.parse(text);
    }

    private resolveManager(
        dir: string,
        pyproject: TomlDocument | undefined,
    ): PythonManager | undefined {
        return (
            this.managerFromLocks(dir, pyproject) ??
            this.managerFromManifest(dir, pyproject)
        );
    }

    private managerFromLocks(
        dir: string,
        pyproject: TomlDocument | undefined,
    ): PythonManager | undefined {
        const poetryLock = this.fs.exists(join(dir, POETRY_LOCK));
        const uvLock = this.fs.exists(join(dir, UV_LOCK));
        return firstPresent([
            [
                poetryLock && uvLock,
                hasSection(pyproject, ["tool", "uv"]) ? "uv" : "poetry",
            ],
            [poetryLock, "poetry"],
            [uvLock, "uv"],
            [this.hasPipenv(dir), "pipenv"],
            [this.fs.exists(join(dir, PDM_LOCK)), "pdm"],
        ]);
    }

    private managerFromManifest(
        dir: string,
        pyproject: TomlDocument | undefined,
    ): PythonManager | undefined {
        const venv = this.findVenv(dir);
        const hasProject = hasSection(pyproject, ["project"]);
        return firstPresent([
            [hasSection(pyproject, ["tool", "poetry"]), "poetry"],
            [hasSection(pyproject, ["tool", "uv"]), "uv"],
            [hasSection(pyproject, ["tool", "pdm"]), "pdm"],
            [hasSection(pyproject, ["tool", "hatch"]), "hatch"],
            [hasProject || venv !== undefined, venv === undefined ? "uv" : "venv"],
        ]);
    }

    private hasPipenv(dir: string): boolean {
        return (
            this.fs.exists(join(dir, PIPFILE)) ||
            this.fs.exists(join(dir, PIPFILE_LOCK))
        );
    }

    private resolveRoot(projectDir: string, manager: PythonManager): string {
        const marker = this.rootMarkers()[manager];
        return marker === undefined
            ? projectDir
            : (nearestSelfOrAncestor(projectDir, marker) ?? projectDir);
    }

    /** Where each manager looks for its workspace root; absent = the project dir. */
    private rootMarkers(): Partial<Record<PythonManager, RootMarker>> {
        return {
            poetry: (dir) => this.fs.exists(join(dir, POETRY_LOCK)),
            uv: (dir) => this.isUvRoot(dir),
            pdm: (dir) => this.fs.exists(join(dir, PDM_LOCK)),
            pipenv: (dir) => this.hasPipenv(dir),
        };
    }

    private isUvRoot(dir: string): boolean {
        if (this.fs.exists(join(dir, UV_LOCK))) {
            return true;
        }
        return hasSection(this.readPyproject(dir), ["tool", "uv", "workspace"]);
    }

    private findVenv(dir: string): string | undefined {
        return VENV_DIRS.map((venv) => join(dir, venv)).find((path) =>
            this.fs.exists(join(path, ...VENV_PYTHON_PATH)),
        );
    }
}
