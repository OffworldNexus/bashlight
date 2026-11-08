import type { NodeManager } from "../../src/project/index.ts";
import type { Fixtures } from "./harness.ts";

export type { Fixtures };

/** Poetry project declaring httpx and pytest. */
export const POETRY_PROJECT: Fixtures = {
    "/w/pyproject.toml": `[tool.poetry]
name = "api"
version = "0.1.0"

[tool.poetry.dependencies]
python = "^3.12"
httpx = "^0.27"
pytest = "^8.0"
`,
    "/w/poetry.lock": "",
};

/** uv project (PEP 621) declaring fastapi and pytest (dev). */
export const UV_PROJECT: Fixtures = {
    "/w/pyproject.toml": `[project]
name = "api"
version = "0.1.0"
dependencies = ["fastapi"]

[tool.uv]
dev-dependencies = ["pytest"]
`,
    "/w/uv.lock": "",
};

/** Pipenv project declaring flask and pytest. */
export const PIPENV_PROJECT: Fixtures = {
    "/w/Pipfile": `[packages]
flask = "*"

[dev-packages]
pytest = "*"
`,
};

/** PDM project declaring flask. */
export const PDM_PROJECT: Fixtures = {
    "/w/pyproject.toml": `[project]
name = "api"
version = "0.1.0"
dependencies = ["flask"]

[tool.pdm]
distribution = true
`,
    "/w/pdm.lock": "",
};

/** Hatch project without a dependency-manager CLI. */
export const HATCH_PROJECT: Fixtures = {
    "/w/pyproject.toml": `[project]
name = "api"
version = "0.1.0"

[tool.hatch.build.targets.wheel]
packages = ["src/api"]
`,
};

/** Plain virtualenv project. */
export const VENV_PROJECT: Fixtures = {
    "/w/pyproject.toml": `[project]
name = "api"
version = "0.1.0"
dependencies = ["flask"]
`,
    "/w/.venv/bin/python": "",
};

export const NPM_PROJECT: Fixtures = {
    "/w/package.json": `{
    "name": "api",
    "dependencies": { "react": "^18.0.0", "eslint": "^9.0.0" }
}`,
    "/w/package-lock.json": "",
};

export const PNPM_PROJECT: Fixtures = {
    "/w/package.json": `{
    "name": "api",
    "dependencies": { "react": "^18.0.0" },
    "devDependencies": { "prettier": "^3.0.0" }
}`,
    "/w/pnpm-lock.yaml": "",
};

export const YARN_PROJECT: Fixtures = {
    "/w/package.json": `{
    "name": "api",
    "dependencies": { "eslint": "^9.0.0" }
}`,
    "/w/yarn.lock": "",
};

export const BUN_PROJECT: Fixtures = {
    "/w/package.json": `{
    "name": "api",
    "dependencies": { "react": "^18.0.0" }
}`,
    "/w/bun.lock": "",
};

const LOCKFILES: Readonly<Record<NodeManager, string>> = {
    npm: "package-lock.json",
    pnpm: "pnpm-lock.yaml",
    yarn: "yarn.lock",
    bun: "bun.lock",
};

/**
 * A Node project tree with the given dev dependencies and extra files (e.g. a
 * script with a shebang).
 */
export function nodeProject(
    manager: NodeManager,
    devDependencies: Readonly<Record<string, string>>,
    extra: Fixtures = {},
): Fixtures {
    return {
        "/w/package.json": JSON.stringify({
            name: "api",
            devDependencies,
        }),
        [`/w/${LOCKFILES[manager]}`]: "",
        ...extra,
    };
}
