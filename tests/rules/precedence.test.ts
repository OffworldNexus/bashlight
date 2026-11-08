import { describe, expect, test } from "bun:test";

import { NPM_PROJECT, POETRY_PROJECT } from "./fixtures.ts";
import { given, kept, rewritten, UNKNOWN } from "./harness.ts";

describe("rule precedence", () => {
    test("pip-to-manager wins over python-runner", () => {
        expect(given(POETRY_PROJECT).run("pip", "install", "requests")).toEqual(
            rewritten(["poetry", "add", "requests"]),
        );
    });

    test("redundant-runner wins before python-runner", () => {
        expect(
            given(POETRY_PROJECT).run("poetry", "run", "poetry", "run", "pytest"),
        ).toEqual(rewritten(["poetry", "run", "pytest"]));
    });

    test("bare-python handles commands without a project", () => {
        expect(given().run("python", "x.py")).toEqual(rewritten(["uv", "run", "x.py"]));
    });

    test("python and node rules do not interfere", () => {
        const both = { ...POETRY_PROJECT, ...NPM_PROJECT };
        expect(given(both).run("pip", "install", "requests")).toEqual(
            rewritten(["poetry", "add", "requests"]),
        );
        expect(given(both).run("npm", "run", "build")).toEqual(kept);
    });
});

describe("scoping", () => {
    test("remote hosts skip every built-in rule", () => {
        expect(
            given(POETRY_PROJECT).remote().run("pip", "install", "requests"),
        ).toEqual(kept);
        expect(given(POETRY_PROJECT).remote().run("python", "x.py")).toEqual(kept);
        expect(given(NPM_PROJECT).remote().run("pnpm", "install")).toEqual(kept);
        expect(given().remote().run("poetry", "run", "poetry", "run", "x")).toEqual(
            kept,
        );
    });

    test("an unknown cwd skips every built-in rule", () => {
        expect(
            given(POETRY_PROJECT).at(undefined).run("pip", "install", "requests"),
        ).toEqual(kept);
        expect(given().at(undefined).run("python", "x.py")).toEqual(kept);
    });

    test("an unknown command name is never inspected", () => {
        expect(given(POETRY_PROJECT).run(UNKNOWN, "install", "requests")).toEqual(kept);
    });
});
