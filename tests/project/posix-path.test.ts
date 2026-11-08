import { describe, expect, test } from "bun:test";

import {
    dirname,
    join,
    nearestSelfOrAncestor,
    normalize,
    selfAndAncestors,
} from "../../src/project/posix-path.ts";

describe("posix-path", () => {
    test("normalize removes trailing slashes", () => {
        expect(normalize("/w/api/")).toBe("/w/api");
        expect(normalize("/")).toBe("/");
        expect(normalize("")).toBe("/");
    });

    test("dirname walks towards the root", () => {
        expect(dirname("/w/api/x")).toBe("/w/api");
        expect(dirname("/w/api")).toBe("/w");
        expect(dirname("/w")).toBe("/");
        expect(dirname("/")).toBe("/");
    });

    test("join builds absolute paths", () => {
        expect(join("/w", "api", "pyproject.toml")).toBe("/w/api/pyproject.toml");
        expect(join("/w/api/", "poetry.lock")).toBe("/w/api/poetry.lock");
        expect(join("/", ".venv", "bin", "python")).toBe("/.venv/bin/python");
        expect(join("/w", "", "x")).toBe("/w/x");
        expect(join("", "x")).toBe("x");
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
