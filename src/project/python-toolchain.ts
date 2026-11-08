import type { FileSystem } from "./file-system.ts";
import { PDM_LOCK, PIPFILE, POETRY_LOCK, PYPROJECT, UV_LOCK } from "./manifests.ts";
import { join } from "./posix-path.ts";
import { TomlDocument } from "./toml-reader.ts";
import type { PythonManager, PythonToolchain } from "./toolchain.ts";

const REQUIREMENT_NAME = /^\s*([A-Za-z0-9._-]+)/;
const INTERPRETER = "python";
const PACKAGES = "packages";
const DEV_PACKAGES = "dev-packages";

/**
 * PEP 503 normalization: lowercase and collapse runs of `-`, `_`, `.` to `-`.
 */
export function normalizePythonName(name: string): string {
    return name
        .trim()
        .toLowerCase()
        .replace(/[-_.]+/g, "-");
}

/** Concrete Python toolchain; reads the manifests lazily and caches the result. */
export class PythonToolchainImpl implements PythonToolchain {
    readonly ecosystem = "python";

    private declarationCache: ReadonlySet<string> | undefined;

    constructor(
        private readonly fs: FileSystem,
        readonly manager: PythonManager,
        readonly root: string,
        readonly venv: string | undefined,
    ) {}

    declares(pkg: string): boolean {
        const normalized = normalizePythonName(pkg);
        if (normalized === "") {
            return false;
        }
        this.declarationCache ??= collectDeclarations(this.fs, this.root);
        return this.declarationCache.has(normalized);
    }
}

function collectDeclarations(fs: FileSystem, root: string): ReadonlySet<string> {
    const names = new Set<string>();
    const pyproject = fs.readText(join(root, PYPROJECT));
    if (pyproject !== undefined) {
        collectFromPyproject(TomlDocument.parse(pyproject), names);
    }
    collectFromLock(fs, join(root, POETRY_LOCK), names);
    collectFromLock(fs, join(root, UV_LOCK), names);
    collectFromLock(fs, join(root, PDM_LOCK), names);
    const pipfile = fs.readText(join(root, PIPFILE));
    if (pipfile !== undefined) {
        const doc = TomlDocument.parse(pipfile);
        addKeys(names, doc.childKeys([PACKAGES]));
        addKeys(names, doc.childKeys([DEV_PACKAGES]));
    }
    return names;
}

function collectFromPyproject(doc: TomlDocument, names: Set<string>): void {
    addRequirements(names, doc.stringList(["project", "dependencies"]));
    for (const group of doc.childKeys(["project", "optional-dependencies"])) {
        addRequirements(
            names,
            doc.stringList(["project", "optional-dependencies", group]),
        );
    }
    for (const group of doc.childKeys(["dependency-groups"])) {
        addRequirements(names, doc.stringList(["dependency-groups", group]));
    }
    addKeys(names, doc.childKeys(["tool", "poetry", "dependencies"]));
    for (const group of doc.childKeys(["tool", "poetry", "group"])) {
        const path = ["tool", "poetry", "group", group, "dependencies"];
        addKeys(names, doc.childKeys(path));
    }
    addKeys(names, doc.childKeys(["tool", "poetry", "dev-dependencies"]));
    addRequirements(names, doc.stringList(["tool", "uv", "dev-dependencies"]));
}

function collectFromLock(fs: FileSystem, path: string, names: Set<string>): void {
    const text = fs.readText(path);
    if (text === undefined) {
        return;
    }
    for (const table of TomlDocument.parse(text).tables(["package"])) {
        const name = table["name"];
        if (typeof name === "string") {
            names.add(normalizePythonName(name));
        }
    }
}

/** Adds table keys that name a dependency (skipping the interpreter constraint). */
function addKeys(names: Set<string>, keys: readonly string[]): void {
    for (const key of keys) {
        if (key.toLowerCase() !== INTERPRETER) {
            names.add(normalizePythonName(key));
        }
    }
}

/** Adds PEP 508 requirement strings, extracting the distribution name. */
function addRequirements(names: Set<string>, specs: readonly string[]): void {
    for (const spec of specs) {
        const name = REQUIREMENT_NAME.exec(spec)?.[1];
        if (name !== undefined) {
            names.add(normalizePythonName(name));
        }
    }
}
