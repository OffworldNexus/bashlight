import { describe, expect, test } from "bun:test";

import { MemoryFileSystem } from "../../src/project/index.ts";

describe("MemoryFileSystem", () => {
    test("reports files, implied directories and missing paths", () => {
        const fs = new MemoryFileSystem({ "/w/api/pyproject.toml": "content" });
        expect(fs.exists("/w/api/pyproject.toml")).toBe(true);
        expect(fs.isDirectory("/w/api/pyproject.toml")).toBe(false);
        expect(fs.readText("/w/api/pyproject.toml")).toBe("content");
        expect(fs.readText("/w/api")).toBeUndefined();
    });

    test("implies parent directories", () => {
        const fs = new MemoryFileSystem({ "/w/packages/a/package.json": "{}" });
        expect(fs.isDirectory("/w/packages/a")).toBe(true);
        expect(fs.isDirectory("/w/packages")).toBe(true);
        expect(fs.isDirectory("/w")).toBe(true);
        expect(fs.isDirectory("/")).toBe(true);
        expect(fs.isDirectory("/nope")).toBe(false);
    });

    test("treats explicit null entries as directories", () => {
        const fs = new MemoryFileSystem({ "/w": null });
        expect(fs.isDirectory("/w")).toBe(true);
        expect(fs.readText("/w")).toBeUndefined();
    });

    test("normalizes trailing slashes", () => {
        const fs = new MemoryFileSystem({ "/w/api/poetry.lock": "" });
        expect(fs.exists("/w/api/poetry.lock/")).toBe(true);
        expect(fs.isDirectory("/w/api/")).toBe(true);
    });

    test("readHead returns only the first bytes and never throws", () => {
        const fs = new MemoryFileSystem({
            "/w/manage.py": "#!/usr/bin/env python3\nprint(1)\n",
        });
        expect(fs.readHead("/w/manage.py", 22)).toBe("#!/usr/bin/env python3");
        expect(fs.readHead("/w/manage.py", 1000)).toBe(
            "#!/usr/bin/env python3\nprint(1)\n",
        );
        expect(fs.readHead("/w/manage.py", 0)).toBe("");
        expect(fs.readHead("/w", 10)).toBeUndefined();
        expect(fs.readHead("/missing", 10)).toBeUndefined();
    });
});
