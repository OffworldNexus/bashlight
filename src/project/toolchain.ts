/**
 * Result types produced by the project inspectors: the toolchains detected for
 * a directory, with the queries rules need about them.
 */

/** Runtime source of truth for the Python managers; the type derives from it. */
export const PYTHON_MANAGERS = [
    "poetry",
    "uv",
    "pipenv",
    "pdm",
    "hatch",
    "venv",
] as const;

/** Runtime source of truth for the Node managers; the type derives from it. */
export const NODE_MANAGERS = ["npm", "pnpm", "yarn", "bun"] as const;

export type PythonManager = (typeof PYTHON_MANAGERS)[number];

export type NodeManager = (typeof NODE_MANAGERS)[number];

export interface PythonToolchain {
    readonly ecosystem: "python";
    readonly manager: PythonManager;
    /** Absolute path of the directory holding the manifest/lock, the runner root. */
    readonly root: string;
    /** Absolute path of an in-project virtualenv whose `bin/python` exists. */
    readonly venv: string | undefined;
    /** Whether `pkg` appears as a dependency (PEP 503 normalized). */
    declares(pkg: string): boolean;
}

export interface NodeToolchain {
    readonly ecosystem: "node";
    readonly manager: NodeManager;
    /** Version from the `packageManager` field (e.g. `"4.1.0"`), if any. */
    readonly managerVersion: string | undefined;
    /** Whether this is a Yarn Berry (v2+) workspace (`.yarnrc.yml` or v2+). */
    readonly yarnBerry: boolean;
    /** Absolute path of the innermost directory holding a `package.json`. */
    readonly root: string;
    /** Nearest ancestor-or-self that is a workspace root (lockfile/workspaces). */
    readonly workspaceRoot: string;
    /** Whether `pkg` is a dependency or installed in `node_modules/.bin`. */
    declares(pkg: string): boolean;
    /** Whether the package defines the named npm script. */
    hasScript(name: string): boolean;
}

export type Toolchain = PythonToolchain | NodeToolchain;
