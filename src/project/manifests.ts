/**
 * Filenames and directory names the project inspection knows about, shared by
 * the detectors and the toolchain implementations so no literal is duplicated.
 */

export const PYPROJECT = "pyproject.toml";
export const POETRY_LOCK = "poetry.lock";
export const UV_LOCK = "uv.lock";
export const PDM_LOCK = "pdm.lock";
export const PIPFILE = "Pipfile";
export const PIPFILE_LOCK = "Pipfile.lock";
export const SETUP_PY = "setup.py";
export const SETUP_CFG = "setup.cfg";
export const REQUIREMENTS_TXT = "requirements.txt";

/** Any of these marks a directory as a Python project root. */
export const PYTHON_PROJECT_FILES = [
    PYPROJECT,
    PIPFILE,
    SETUP_PY,
    SETUP_CFG,
    REQUIREMENTS_TXT,
] as const;

/** Candidate in-project virtualenv directory names, in preference order. */
export const VENV_DIRS = [".venv", "venv"] as const;

/** Path segments of the interpreter inside a virtualenv. */
export const VENV_PYTHON_PATH = ["bin", "python"] as const;

export const PACKAGE_JSON = "package.json";
export const PNPM_WORKSPACE = "pnpm-workspace.yaml";
export const PNPM_LOCK = "pnpm-lock.yaml";
export const BUN_LOCK = "bun.lock";
export const BUN_LOCKB = "bun.lockb";
export const YARN_LOCK = "yarn.lock";
export const YARNRC_YML = ".yarnrc.yml";
export const NPM_LOCK = "package-lock.json";

export const NODE_MODULES = "node_modules";
export const BIN_DIR = ".bin";
