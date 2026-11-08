import { describe, expect, test } from "bun:test";

import {
    basename,
    dirname,
    isInside,
    join,
    nearestSelfOrAncestor,
    normalize,
    normalizeAbsolute,
    relative,
    resolve,
    selfAndAncestors,
} from "../../src/shared/posix-path.ts";

describe("posix-path", () => {
    test("normalize removes trailing slashes", () => {
        expect(normalize("/w/api/")).toBe("/w/api");
        expect(normalize("/")).toBe("/");
        expect(normalize("")).toBe("/");
    });

    test("normalizeAbsolute collapses . and ..", () => {
        expect(normalizeAbsolute("/w/api/./src/../x")).toBe("/w/api/x");
        expect(normalizeAbsolute("/w/../../x")).toBe("/x");
        expect(normalizeAbsolute("")).toBe("/");
    });

    test("dirname walks towards the root", () => {
        expect(dirname("/w/api/x")).toBe("/w/api");
        expect(dirname("/w/api")).toBe("/w");
        expect(dirname("/w")).toBe("/");
        expect(dirname("/")).toBe("/");
    });

    test("basename returns the last segment", () => {
        expect(basename("/w/api/manage.py")).toBe("manage.py");
        expect(basename("/w/api/")).toBe("api");
        expect(basename("/")).toBe("/");
    });

    test("join builds absolute paths", () => {
        expect(join("/w", "api", "pyproject.toml")).toBe("/w/api/pyproject.toml");
        expect(join("/w/api/", "poetry.lock")).toBe("/w/api/poetry.lock");
        expect(join("/", ".venv", "bin", "python")).toBe("/.venv/bin/python");
        expect(join("/w", "", "x")).toBe("/w/x");
        expect(join("", "x")).toBe("x");
    });

    test("resolve resolves against cwd", () => {
        expect(resolve("/w", "./manage.py")).toBe("/w/manage.py");
        expect(resolve("/w/api", "../manage.py")).toBe("/w/manage.py");
        expect(resolve("/w", "/abs/x")).toBe("/abs/x");
        expect(resolve(undefined, "x")).toBeUndefined();
        expect(resolve(undefined, "/abs/x")).toBe("/abs/x");
    });

    test("isInside is parent-or-below", () => {
        expect(isInside("/w/api", "/w")).toBe(true);
        expect(isInside("/w", "/w")).toBe(true);
        expect(isInside("/w0", "/w")).toBe(false);
        expect(isInside("/w/api", "/")).toBe(true);
        expect(isInside("/", "/")).toBe(true);
    });

    test("relative computes a relative path", () => {
        expect(relative("/w/src", "/w/.venv/bin/pytest")).toBe("../.venv/bin/pytest");
        expect(relative("/w", "/w/.venv/bin/python")).toBe(".venv/bin/python");
        expect(relative("/w", "/w")).toBe(".");
    });

    test("selfAndAncestors stops at the filesystem root", () => {
        expect(selfAndAncestors("/w/api/src")).toEqual([
            "/w/api/src",
            "/w/api",
            "/w",
            "/",
        ]);
        expect(selfAndAncestors("/")).toEqual(["/"]);
    });

    test("nearestSelfOrAncestor finds the innermost match", () => {
        expect(nearestSelfOrAncestor("/w/api/src", (dir) => dir === "/w")).toBe("/w");
        expect(nearestSelfOrAncestor("/w/api", (dir) => dir === "/w/api")).toBe(
            "/w/api",
        );
        expect(nearestSelfOrAncestor("/w/api", () => false)).toBeUndefined();
    });
});
