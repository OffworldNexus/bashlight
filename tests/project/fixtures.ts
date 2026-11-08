import {
    MemoryFileSystem,
    type NodeToolchain,
    NodeToolchainDetector,
    type PythonToolchain,
    PythonToolchainDetector,
} from "../../src/project/index.ts";

/** An in-memory tree: absolute path → content (`string`) or directory (`null`). */
export type Entries = Readonly<Record<string, string | null>>;

/** Detects the Python toolchain governing `dir` in a fresh in-memory tree. */
export function detectPython(
    entries: Entries,
    dir: string,
): PythonToolchain | undefined {
    return new PythonToolchainDetector(new MemoryFileSystem(entries)).detect(dir);
}

/** Detects the Node toolchain governing `dir` in a fresh in-memory tree. */
export function detectNode(entries: Entries, dir: string): NodeToolchain | undefined {
    return new NodeToolchainDetector(new MemoryFileSystem(entries)).detect(dir);
}

export const POETRY_PYPROJECT = `[tool.poetry]
name = "api"
version = "0.1.0"

[tool.poetry.dependencies]
python = "^3.12"
httpx = "^0.27"
`;

export const UV_PYPROJECT = `[project]
name = "api"
version = "0.1.0"
dependencies = ["fastapi>=0.110"]

[tool.uv]
dev-dependencies = ["pytest>=8"]
`;

export const HATCH_PYPROJECT = `[project]
name = "api"
version = "0.1.0"

[tool.hatch.build.targets.wheel]
packages = ["src/api"]
`;

export const PDM_PYPROJECT = `[project]
name = "api"
version = "0.1.0"

[tool.pdm]
distribution = true
`;

export const PEP621_PYPROJECT = `[project]
name = "api"
version = "0.1.0"
dependencies = ["fastapi>=0.110"]
`;

export const POETRY_LOCK = `[[package]]
name = "certifi"
version = "2024.2.2"

[[package]]
name = "charset-normalizer"
version = "3.3.2"
`;

export const UV_LOCK = `version = 1
requires-python = ">=3.12"

[[package]]
name = "anyio"
version = "4.3.0"
`;

export const PDM_LOCK = `[[package]]
name = "click"
version = "8.1.7"
`;

export const PIPFILE = `[packages]
flask = "*"

[dev-packages]
pytest = "*"
`;
