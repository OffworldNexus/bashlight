import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createProjectInspector, NodeFileSystem } from "../../src/project/index.ts";
import { POETRY_LOCK, POETRY_PYPROJECT } from "./fixtures.ts";

let root = "";

describe("NodeFileSystem", () => {
    beforeAll(() => {
        const base = join(tmpdir(), "opencode");
        mkdirSync(base, { recursive: true });
        root = mkdtempSync(join(base, "bashlight-fs-"));
        mkdirSync(join(root, "sub"), { recursive: true });
        writeFileSync(join(root, "file.txt"), "hello");
    });

    afterAll(() => {
        rmSync(root, { recursive: true, force: true });
    });

    const fs = new NodeFileSystem();

    test("reports existing files, directories and missing paths", () => {
        expect(fs.exists(join(root, "file.txt"))).toBe(true);
        expect(fs.exists(join(root, "missing"))).toBe(false);
        expect(fs.isDirectory(root)).toBe(true);
        expect(fs.isDirectory(join(root, "sub"))).toBe(true);
        expect(fs.isDirectory(join(root, "file.txt"))).toBe(false);
        expect(fs.isDirectory(join(root, "missing"))).toBe(false);
        expect(fs.readText(join(root, "file.txt"))).toBe("hello");
        expect(fs.readText(root)).toBeUndefined();
        expect(fs.readText(join(root, "missing"))).toBeUndefined();
    });

    test("degrades to false/undefined when the OS refuses access", () => {
        const secret = join(root, "secret.txt");
        writeFileSync(secret, "top secret");
        chmodSync(secret, 0o000);
        try {
            expect(fs.readText(secret)).toBeUndefined();
        } finally {
            chmodSync(secret, 0o600);
        }

        const locked = join(root, "locked");
        mkdirSync(locked);
        chmodSync(locked, 0o000);
        try {
            expect(fs.exists(join(locked, "child"))).toBe(false);
            expect(fs.isDirectory(join(locked, "child"))).toBe(false);
        } finally {
            chmodSync(locked, 0o700);
        }
    });

    test("detects a real project from disk", () => {
        writeFileSync(join(root, "pyproject.toml"), POETRY_PYPROJECT);
        writeFileSync(join(root, "poetry.lock"), POETRY_LOCK);

        const inspector = createProjectInspector(new NodeFileSystem());
        expect(inspector.python(root)?.manager).toBe("poetry");
        expect(inspector.python(root)?.root).toBe(root);
        expect(inspector.python(root)?.declares("certifi")).toBe(true);
    });

    test("readHead reads only the requested prefix", () => {
        const file = join(root, "head.txt");
        writeFileSync(file, "first line\nsecond line\n");
        expect(fs.readHead(file, 10)).toBe("first line");
        expect(fs.readHead(file, 1000)).toBe("first line\nsecond line\n");
        expect(fs.readHead(file, 0)).toBe("");
        expect(fs.readHead(join(root, "missing"), 10)).toBeUndefined();
        expect(fs.readHead(root, 10)).toBeUndefined();
    });

    test("listDirectory lists entries and degrades to undefined", () => {
        expect(fs.listDirectory(root)?.includes("sub")).toBe(true);
        expect(fs.listDirectory(join(root, "sub"))).toEqual([]);
        expect(fs.listDirectory(join(root, "file.txt"))).toBeUndefined();
        expect(fs.listDirectory(join(root, "missing"))).toBeUndefined();
    });
});
