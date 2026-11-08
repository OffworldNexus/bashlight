import { describe, expect, test } from "bun:test";

import { detectNode, detectPython } from "./fixtures.ts";

describe("PythonToolchain.declares", () => {
    const entries = {
        "/w/api/pyproject.toml": `[project]
name = "api"
dependencies = ["fastapi>=0.110", "Requests[security]>=2.31"]

[project.optional-dependencies]
dev = ["pytest", "ruff"]

[dependency-groups]
test = ["coverage"]

[tool.uv]
dev-dependencies = ["mypy"]
`,
        "/w/api/uv.lock": `[[package]]
name = "click"
version = "8.1.7"
`,
    };

    test("finds dependencies from every manifest source", () => {
        const tc = detectPython(entries, "/w/api");
        expect(tc?.manager).toBe("uv");
        expect(tc?.declares("fastapi")).toBe(true);
        expect(tc?.declares("requests")).toBe(true);
        expect(tc?.declares("pytest")).toBe(true);
        expect(tc?.declares("ruff")).toBe(true);
        expect(tc?.declares("coverage")).toBe(true);
        expect(tc?.declares("mypy")).toBe(true);
        expect(tc?.declares("click")).toBe(true);
        expect(tc?.declares("flask")).toBe(false);
        expect(tc?.declares("")).toBe(false);
    });

    test("normalizes names with PEP 503", () => {
        const tc = detectPython(
            {
                "/w/api/pyproject.toml": `[tool.poetry]
name = "api"

[tool.poetry.dependencies]
python = "^3.12"
Django = "^5"
"zope.interface" = "^6"

[tool.poetry.group.dev.dependencies]
pytest = "^8"
`,
            },
            "/w/api",
        );
        expect(tc?.declares("django")).toBe(true);
        expect(tc?.declares("Django")).toBe(true);
        expect(tc?.declares("zope-interface")).toBe(true);
        expect(tc?.declares("zope.interface")).toBe(true);
        expect(tc?.declares("zope_interface")).toBe(true);
        expect(tc?.declares("pytest")).toBe(true);
        expect(tc?.declares("python")).toBe(false);
    });

    test("reads Pipfile packages and dev-packages", () => {
        const tc = detectPython(
            {
                "/w/api/Pipfile":
                    '[packages]\nflask = "*"\n\n[dev-packages]\npytest = "*"\n',
            },
            "/w/api",
        );
        expect(tc?.declares("flask")).toBe(true);
        expect(tc?.declares("pytest")).toBe(true);
        expect(tc?.declares("django")).toBe(false);
    });

    test("malformed pyproject does not throw", () => {
        const tc = detectPython(
            {
                "/w/api/pyproject.toml": "[tool.poetry\nname =",
                "/w/api/poetry.lock": `[[package]]
name = "click"
`,
            },
            "/w/api",
        );
        expect(tc?.manager).toBe("poetry");
        expect(tc?.declares("click")).toBe(true);
        expect(tc?.declares("requests")).toBe(false);
    });
});

describe("NodeToolchain.declares", () => {
    const entries = {
        "/w/api/package.json": `{
    "name": "api",
    "dependencies": { "Lodash": "^4" },
    "devDependencies": { "typescript": "^5" },
    "peerDependencies": { "react": "^18" },
    "optionalDependencies": { "@types/node": "^20" },
    "scripts": { "build": "tsc", "test": "vitest" }
}`,
        "/w/api/package-lock.json": "",
        "/w/api/node_modules/.bin/eslint": "",
    };

    test("finds dependencies from every field and the bin directory", () => {
        const tc = detectNode(entries, "/w/api");
        expect(tc?.manager).toBe("npm");
        expect(tc?.declares("lodash")).toBe(true);
        expect(tc?.declares("Lodash")).toBe(true);
        expect(tc?.declares("typescript")).toBe(true);
        expect(tc?.declares("react")).toBe(true);
        expect(tc?.declares("@types/node")).toBe(true);
        expect(tc?.declares("eslint")).toBe(true);
        expect(tc?.declares("express")).toBe(false);
    });

    test("reports declared scripts", () => {
        const tc = detectNode(entries, "/w/api");
        expect(tc?.hasScript("build")).toBe(true);
        expect(tc?.hasScript("test")).toBe(true);
        expect(tc?.hasScript("lint")).toBe(false);
    });

    test("considers both the root and workspace package.json", () => {
        const tc = detectNode(
            {
                "/w/package.json": `{ "name": "root", "workspaces": ["packages/*"], "devDependencies": { "eslint": "^9" } }`,
                "/w/pnpm-lock.yaml": "",
                "/w/packages/a/package.json": `{ "name": "a", "dependencies": { "express": "^4" } }`,
                "/w/node_modules/.bin/tsc": "",
            },
            "/w/packages/a",
        );
        expect(tc?.declares("express")).toBe(true);
        expect(tc?.declares("eslint")).toBe(true);
        expect(tc?.declares("tsc")).toBe(true);
        expect(tc?.declares("react")).toBe(false);
    });
});
