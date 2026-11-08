import { describe, expect, test } from "bun:test";

import {
    BUN_PROJECT,
    NPM_PROJECT,
    PDM_PROJECT,
    PIPENV_PROJECT,
    PNPM_PROJECT,
    UV_PROJECT,
} from "./fixtures.ts";
import { given, kept, rewritten } from "./harness.ts";

describe("redundant-runner — python", () => {
    test("collapses repeated python runners", () => {
        expect(given().run("poetry", "run", "poetry", "run", "x")).toEqual(
            rewritten(["poetry", "run", "x"]),
        );
        expect(given(UV_PROJECT).run("uv", "run", "uv", "run", "pytest")).toEqual(
            rewritten(["uv", "run", "pytest"]),
        );
        expect(
            given(PIPENV_PROJECT).run("pipenv", "run", "pipenv", "run", "pytest"),
        ).toEqual(rewritten(["pipenv", "run", "pytest"]));
        expect(given(PDM_PROJECT).run("pdm", "run", "pdm", "run", "pytest")).toEqual(
            rewritten(["pdm", "run", "pytest"]),
        );
    });

    test("collapses across poetry's own prefix options", () => {
        expect(given().run("poetry", "-C", "api", "run", "poetry", "run", "x")).toEqual(
            rewritten(["poetry", "-C", "api", "run", "x"]),
        );
    });

    test("does not collapse different or incomplete runners", () => {
        expect(given().run("poetry", "run", "uv", "run", "x")).toEqual(kept);
        expect(given().run("poetry", "run", "pytest")).toEqual(kept);
        expect(given().run("pipenv", "run", "pipenv", "run")).toEqual(kept);
    });
});

describe("redundant-runner — node", () => {
    test("collapses repeated exec prefixes", () => {
        expect(given(NPM_PROJECT).run("npx", "npx", "x")).toEqual(
            rewritten(["npx", "x"]),
        );
        expect(given(PNPM_PROJECT).run("pnpm", "exec", "pnpm", "exec", "x")).toEqual(
            rewritten(["pnpm", "exec", "x"]),
        );
        expect(given(NPM_PROJECT).run("npx", "-y", "npx", "x")).toEqual(
            rewritten(["npx", "-y", "x"]),
        );
        expect(given(BUN_PROJECT).run("bunx", "bunx", "x")).toEqual(
            rewritten(["bunx", "x"]),
        );
    });

    test("does not collapse a nested shorthand run", () => {
        expect(given().run("npx", "pnpm", "x")).toEqual(kept);
    });
});
