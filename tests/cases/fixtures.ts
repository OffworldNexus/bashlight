/**
 * Fixture trees and a one-line runner for the end-to-end cases.
 *
 * `poetryProject("/w")` builds a Poetry project declaring httpx and pytest;
 * `rewrite(command, fixtures)` runs it through the real `createBashlight`
 * pipeline over a `MemoryFileSystem`.
 */

import { createBashlight } from "../../src/bashlight.ts";
import type { Outcome } from "../../src/outcome.ts";
import { MemoryFileSystem } from "../../src/project/index.ts";

export type Fixtures = Readonly<Record<string, string | null>>;

const PYTHON = `python = "^3.12"`;

/** Poetry project declaring httpx and pytest, plus a Python-shebang script. */
export function poetryProject(root = "/w"): Fixtures {
    return {
        [`${root}/pyproject.toml`]: `[tool.poetry]
name = "api"
version = "0.1.0"

[tool.poetry.dependencies]
${PYTHON}
httpx = "^0.27"
pytest = "^8.0"
`,
        [`${root}/poetry.lock`]: "",
        [`${root}/manage.py`]: "#!/usr/bin/env python3\nprint(1)\n",
    };
}

/** uv (PEP 621) project declaring fastapi and pytest (dev). */
export function uvProject(root = "/w"): Fixtures {
    return {
        [`${root}/pyproject.toml`]: `[project]
name = "api"
version = "0.1.0"
dependencies = ["fastapi"]

[tool.uv]
dev-dependencies = ["pytest"]
`,
        [`${root}/uv.lock`]: "",
        [`${root}/manage.py`]: "#!/usr/bin/env python3\nprint(1)\n",
        [`${root}/scripts/report.py`]: "#!/usr/bin/python3\nprint(1)\n",
    };
}

/** Plain virtualenv project declaring flask, plus a Python-shebang script. */
export function venvProject(root = "/w"): Fixtures {
    return {
        [`${root}/pyproject.toml`]: `[project]
name = "api"
version = "0.1.0"
dependencies = ["flask"]
`,
        [`${root}/.venv/bin/python`]: "",
        [`${root}/app.py`]: "#!/usr/bin/env python3\nprint(1)\n",
    };
}

/** pnpm project declaring vitest. */
export function pnpmProject(root = "/w"): Fixtures {
    return {
        [`${root}/package.json`]: JSON.stringify({
            name: "api",
            devDependencies: { vitest: "^1.0.0" },
        }),
        [`${root}/pnpm-lock.yaml`]: "",
    };
}

/** npm project declaring vitest. */
export function npmProject(root = "/w"): Fixtures {
    return {
        [`${root}/package.json`]: JSON.stringify({
            name: "web",
            devDependencies: { vitest: "^1.0.0" },
        }),
        [`${root}/package-lock.json`]: "",
    };
}

/** Yarn (classic) project declaring eslint. */
export function yarnProject(root = "/w"): Fixtures {
    return {
        [`${root}/package.json`]: JSON.stringify({
            name: "web",
            devDependencies: { eslint: "^9.0.0" },
        }),
        [`${root}/yarn.lock`]: "",
    };
}

/** Bun project declaring vitest. */
export function bunProject(root = "/w"): Fixtures {
    return {
        [`${root}/package.json`]: JSON.stringify({
            name: "web",
            devDependencies: { vitest: "^1.0.0" },
        }),
        [`${root}/bun.lock`]: "",
    };
}

/** pnpm project declaring tsx and vitest, plus a tsx-shebang script. */
export function tsxProject(root = "/w"): Fixtures {
    return {
        [`${root}/package.json`]: JSON.stringify({
            name: "web",
            devDependencies: { tsx: "^4.0.0", vitest: "^1.0.0" },
        }),
        [`${root}/pnpm-lock.yaml`]: "",
        [`${root}/bin/cli`]: "#!/usr/bin/env tsx\nconsole.log(1)\n",
    };
}

/** No project markers at all: a plain directory. */
export function noProject(): Fixtures {
    return {};
}

export interface RunOptions {
    readonly cwd?: string;
    readonly env?: Readonly<Record<string, string>>;
    readonly files?: Fixtures;
}

export const DEFAULT_ENV = { HOME: "/home/user", PATH: "/usr/bin:/bin" };

export function rewrite(command: string, options: RunOptions = {}): Outcome {
    const processor = createBashlight({
        fileSystem: new MemoryFileSystem(options.files ?? {}),
    });
    return processor.process({
        command,
        cwd: options.cwd ?? "/w",
        env: options.env ?? DEFAULT_ENV,
    });
}

/** The rewritten command, or `undefined` when it was kept/blocked. */
export function rewritten(
    command: string,
    options: RunOptions = {},
): string | undefined {
    const outcome = rewrite(command, options);
    return outcome.kind === "rewritten" ? outcome.command : undefined;
}
