import { describe, expect, test } from "bun:test";

import type { NodeManager } from "../../src/project/index.ts";
import {
    type ExecKind,
    nodeDialect,
    nodeScriptTool,
    parseNodeCommand,
} from "../../src/rules/knowledge/node-command-line.ts";
import type { CallArg, Replacement } from "../../src/rules/rule.ts";

function args(...values: string[]): CallArg[] {
    return values.map((value) => ({ value, origin: "literal" }));
}

function parse(...values: string[]) {
    return parseNodeCommand(args(...values));
}

function render(
    target: NodeManager,
    command: ReturnType<typeof parse>,
    original: CallArg[],
    exec: ExecKind = "download",
    yarnBerry = false,
): (string | undefined)[] {
    if (command === undefined) {
        return [];
    }
    const replacements: readonly Replacement[] = nodeDialect(target).render(command, {
        exec,
        yarnBerry,
    });
    return replacements.map((replacement) =>
        replacement.kind === "text"
            ? replacement.value
            : original[replacement.index]?.value,
    );
}

describe("parseNodeCommand — npm", () => {
    test("install family", () => {
        expect(parse("npm", "install")?.action).toEqual({ kind: "install" });
        expect(parse("npm", "i")?.action).toEqual({ kind: "install" });
        expect(parse("npm", "ci")?.action).toEqual({ kind: "ci" });
        expect(parse("npm", "install", "-D", "x")?.action).toEqual({
            kind: "add",
            packages: [3],
            dev: true,
            exact: false,
            optional: false,
        });
        expect(parse("npm", "install", "-E", "-O", "x", "y")?.action).toEqual({
            kind: "add",
            packages: [4, 5],
            dev: false,
            exact: true,
            optional: true,
        });
        expect(parse("npm", "uninstall", "x", "y")?.action).toEqual({
            kind: "remove",
            packages: [2, 3],
        });
    });

    test("run and lifecycle aliases", () => {
        expect(parse("npm", "run", "lint")?.action).toEqual({
            kind: "run",
            script: 2,
            args: [],
        });
        expect(parse("npm", "run", "test", "--", "a", "b")?.action).toEqual({
            kind: "run",
            script: 2,
            args: [4, 5],
        });
        expect(parse("npm", "test")?.action).toEqual({
            kind: "run",
            script: 1,
            args: [],
        });
        expect(parse("npm", "t")?.action).toMatchObject({ scriptName: "test" });
    });

    test("exec, global and conservative 'other'", () => {
        expect(parse("npm", "exec", "foo", "a")?.action).toEqual({
            kind: "exec",
            binary: 2,
            args: [3],
            download: false,
            packages: [],
        });
        expect(parse("npm", "install", "-g", "x")?.action).toEqual({ kind: "global" });
        expect(parse("npm", "install", "--production")?.action).toEqual({
            kind: "other",
        });
        expect(parse("npm", "publish")?.action).toEqual({ kind: "other" });
    });
});

describe("parseNodeCommand — other managers", () => {
    test("npx/pnpx/bunx", () => {
        expect(parse("npx", "-y", "foo")?.action).toMatchObject({
            kind: "exec",
            binary: 2,
            download: true,
        });
        expect(parse("npx", "-p", "pkg", "bar")?.action).toMatchObject({
            kind: "exec",
            binary: 3,
            packages: [2],
        });
        expect(parse("bunx", "foo")?.manager).toBe("bun");
        expect(parse("pnpx", "foo")?.manager).toBe("pnpm");
    });

    test("pnpm", () => {
        expect(parse("pnpm", "install", "--frozen-lockfile")?.action).toEqual({
            kind: "ci",
        });
        expect(parse("pnpm", "add", "-D", "x")?.action).toMatchObject({
            kind: "add",
            dev: true,
        });
        expect(parse("pnpm", "exec", "eslint")?.action).toMatchObject({
            kind: "exec",
            download: false,
        });
        expect(parse("pnpm", "dlx", "x")?.action).toMatchObject({
            kind: "exec",
            download: true,
        });
        expect(parse("pnpm", "lint")?.action).toMatchObject({ kind: "run", script: 1 });
        expect(parse("pnpm", "test")?.action).toMatchObject({ kind: "run", script: 1 });
        expect(parse("pnpm", "outdated")?.action).toEqual({ kind: "other" });
    });

    test("yarn", () => {
        expect(parse("yarn")?.action).toEqual({ kind: "install" });
        expect(parse("yarn", "--frozen-lockfile")?.action).toEqual({ kind: "ci" });
        expect(parse("yarn", "add", "--dev", "x")?.action).toMatchObject({
            kind: "add",
            dev: true,
        });
        expect(parse("yarn", "dlx", "x")?.action).toMatchObject({
            kind: "exec",
            download: true,
        });
        expect(parse("yarn", "lint")?.action).toMatchObject({ kind: "run", script: 1 });
        expect(parse("yarn", "global", "add", "x")?.action).toEqual({ kind: "global" });
    });

    test("bun", () => {
        expect(parse("bun", "install")?.action).toEqual({ kind: "install" });
        expect(parse("bun", "add", "-d", "x")?.action).toMatchObject({
            kind: "add",
            dev: true,
        });
        expect(parse("bun", "x", "foo")?.action).toMatchObject({
            kind: "exec",
            download: true,
        });
        expect(parse("bun", "remove", "x")?.action).toEqual({
            kind: "remove",
            packages: [2],
        });
        expect(parse("bun", "test")?.action).toEqual({ kind: "other" });
    });

    test("non node commands are undefined", () => {
        expect(parse("cargo", "build")).toBeUndefined();
        expect(parse()).toBeUndefined();
    });
});

describe("NodeDialect rendering", () => {
    test("add flags differ per manager", () => {
        const original = args("npm", "install", "-D", "-E", "x");
        const command = parseNodeCommand(original);
        expect(render("pnpm", command, original)).toEqual([
            "pnpm",
            "add",
            "-D",
            "-E",
            "x",
        ]);
        expect(render("bun", command, original)).toEqual([
            "bun",
            "add",
            "-d",
            "--exact",
            "x",
        ]);
        expect(render("yarn", command, original)).toEqual([
            "yarn",
            "add",
            "-D",
            "-E",
            "x",
        ]);
    });

    test("exec uses the designed kind to choose exec vs dlx", () => {
        const original = args("npx", "foo");
        const command = parseNodeCommand(original);
        expect(render("pnpm", command, original, "installed")).toEqual([
            "pnpm",
            "exec",
            "foo",
        ]);
        expect(render("pnpm", command, original, "download")).toEqual([
            "pnpm",
            "dlx",
            "foo",
        ]);
    });

    test("run uses npm's -- only for npm", () => {
        const original = args("yarn", "run", "test", "--", "a");
        const command = parseNodeCommand(original);
        expect(render("npm", command, original)).toEqual([
            "npm",
            "run",
            "test",
            "--",
            "a",
        ]);
        expect(render("pnpm", command, original)).toEqual(["pnpm", "run", "test", "a"]);
    });

    test("exec prefixes per manager", () => {
        const prefix = (manager: NodeManager, kind: ExecKind, berry = false) =>
            nodeDialect(manager).execPrefix(kind, berry, false);
        expect(prefix("npm", "installed")).toEqual(["npx"]);
        expect(prefix("npm", "download")).toEqual(["npx", "-y"]);
        expect(prefix("pnpm", "installed")).toEqual(["pnpm", "exec"]);
        expect(prefix("pnpm", "download")).toEqual(["pnpm", "dlx"]);
        expect(prefix("yarn", "installed", true)).toEqual(["yarn", "exec"]);
        expect(prefix("yarn", "download", true)).toEqual(["yarn", "dlx"]);
        expect(prefix("yarn", "installed", false)).toEqual(["npx"]);
        expect(prefix("yarn", "download", false)).toEqual(["npx", "-y"]);
        expect(prefix("bun", "download")).toEqual(["bunx"]);
    });

    test("exec keeps -p/--package per manager", () => {
        const original = args("npx", "-p", "pkg", "bin");
        const command = parseNodeCommand(original);
        expect(render("npm", command, original)).toEqual(["npx", "-p", "pkg", "bin"]);
        expect(render("pnpm", command, original)).toEqual([
            "pnpm",
            "dlx",
            "--package",
            "pkg",
            "bin",
        ]);
        expect(render("yarn", command, original, "download", true)).toEqual([
            "yarn",
            "dlx",
            "-p",
            "pkg",
            "bin",
        ]);
        // bun cannot express `--package`, so the rule keeps the command.
        expect(render("bun", command, original)).toEqual([]);
    });

    test("yarn classic vs berry", () => {
        expect(render("yarn", parse("npm", "ci"), args("npm", "ci"))).toEqual([
            "yarn",
            "install",
            "--frozen-lockfile",
        ]);
        expect(
            render("yarn", parse("npm", "ci"), args("npm", "ci"), "download", true),
        ).toEqual(["yarn", "install", "--immutable"]);
    });
});

describe("nodeScriptTool", () => {
    test("recognizes env-resolved node tools", () => {
        expect(
            nodeScriptTool({ interpreter: "tsx", args: [], viaEnv: true, raw: "" }),
        ).toBe("tsx");
        expect(
            nodeScriptTool({ interpreter: "ts-node", args: [], viaEnv: true, raw: "" }),
        ).toBe("ts-node");
    });

    test("excludes runtimes, managers, python and absolute interpreters", () => {
        expect(
            nodeScriptTool({ interpreter: "node", args: [], viaEnv: true, raw: "" }),
        ).toBeUndefined();
        expect(
            nodeScriptTool({ interpreter: "pnpm", args: [], viaEnv: true, raw: "" }),
        ).toBeUndefined();
        expect(
            nodeScriptTool({ interpreter: "python3", args: [], viaEnv: true, raw: "" }),
        ).toBeUndefined();
        expect(
            nodeScriptTool({ interpreter: "uv", args: [], viaEnv: true, raw: "" }),
        ).toBeUndefined();
        expect(
            nodeScriptTool({
                interpreter: "/usr/bin/tsx",
                args: [],
                viaEnv: false,
                raw: "",
            }),
        ).toBeUndefined();
    });
});
