import { describe, expect, test } from "bun:test";

import { detectNode } from "./fixtures.ts";

const PKG = `{ "name": "api" }`;

describe("NodeToolchainDetector: managers", () => {
    test("npm from a lockfile", () => {
        const tc = detectNode(
            { "/w/api/package.json": PKG, "/w/api/package-lock.json": "" },
            "/w/api",
        );
        expect(tc?.manager).toBe("npm");
        expect(tc?.root).toBe("/w/api");
        expect(tc?.workspaceRoot).toBe("/w/api");
    });

    test("pnpm from a lockfile", () => {
        const tc = detectNode(
            { "/w/api/package.json": PKG, "/w/api/pnpm-lock.yaml": "" },
            "/w/api",
        );
        expect(tc?.manager).toBe("pnpm");
    });

    test("yarn from a lockfile", () => {
        const tc = detectNode(
            { "/w/api/package.json": PKG, "/w/api/yarn.lock": "" },
            "/w/api",
        );
        expect(tc?.manager).toBe("yarn");
    });

    test("bun from a binary lockfile", () => {
        const tc = detectNode(
            { "/w/api/package.json": PKG, "/w/api/bun.lockb": "" },
            "/w/api",
        );
        expect(tc?.manager).toBe("bun");
    });

    test("packageManager field wins over the lockfile", () => {
        const tc = detectNode(
            {
                "/w/api/package.json": `{ "name": "api", "packageManager": "yarn@4.1.0" }`,
                "/w/api/package-lock.json": "",
            },
            "/w/api",
        );
        expect(tc?.manager).toBe("yarn");
    });

    test("packageManager alone is enough", () => {
        const tc = detectNode(
            {
                "/w/api/package.json": `{ "name": "api", "packageManager": "pnpm@9.1.0" }`,
            },
            "/w/api",
        );
        expect(tc?.manager).toBe("pnpm");
    });

    test("an unknown packageManager falls back to the lockfile", () => {
        const tc = detectNode(
            {
                "/w/api/package.json": `{ "name": "api", "packageManager": "corepack@0.1.0" }`,
                "/w/api/package-lock.json": "",
            },
            "/w/api",
        );
        expect(tc?.manager).toBe("npm");
    });
});

describe("NodeToolchainDetector: workspaces and edge cases", () => {
    test("sub-package with a root lockfile", () => {
        const tc = detectNode(
            {
                "/w/package.json": `{ "name": "root", "workspaces": ["packages/*"] }`,
                "/w/yarn.lock": "",
                "/w/packages/a/package.json": PKG,
            },
            "/w/packages/a",
        );
        expect(tc?.manager).toBe("yarn");
        expect(tc?.root).toBe("/w/packages/a");
        expect(tc?.workspaceRoot).toBe("/w");
    });

    test("pnpm workspace with a sub-package", () => {
        const tc = detectNode(
            {
                "/w/pnpm-workspace.yaml": "packages:\n  - packages/*\n",
                "/w/pnpm-lock.yaml": "",
                "/w/package.json": `{ "name": "root" }`,
                "/w/packages/a/package.json": PKG,
            },
            "/w/packages/a",
        );
        expect(tc?.manager).toBe("pnpm");
        expect(tc?.workspaceRoot).toBe("/w");
    });

    test("workspace root packageManager applies to sub-packages", () => {
        const tc = detectNode(
            {
                "/w/package.json": `{ "name": "root", "workspaces": ["packages/*"], "packageManager": "pnpm@9.1.0" }`,
                "/w/packages/a/package.json": PKG,
            },
            "/w/packages/a",
        );
        expect(tc?.manager).toBe("pnpm");
        expect(tc?.workspaceRoot).toBe("/w");
    });

    test("a package.json without a lockfile or manager has no toolchain", () => {
        expect(detectNode({ "/w/api/package.json": PKG }, "/w/api")).toBeUndefined();
    });

    test("no package.json at all", () => {
        expect(detectNode({ "/etc/hosts": "" }, "/etc")).toBeUndefined();
    });

    test("finds the package from a deep cwd", () => {
        const tc = detectNode(
            {
                "/w/api/package.json": PKG,
                "/w/api/package-lock.json": "",
                "/w/api/src/app/index.ts": "",
            },
            "/w/api/src/app",
        );
        expect(tc?.manager).toBe("npm");
        expect(tc?.root).toBe("/w/api");
    });

    test("malformed package.json does not throw and falls back to the lockfile", () => {
        const tc = detectNode(
            { "/w/api/package.json": "{ not json", "/w/api/package-lock.json": "" },
            "/w/api",
        );
        expect(tc?.manager).toBe("npm");
        expect(tc?.declares("express")).toBe(false);
        expect(tc?.hasScript("build")).toBe(false);
    });
});
