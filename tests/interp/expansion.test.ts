import { describe, expect, test } from "bun:test";

import type { Binding } from "../../src/interp/index.ts";
import { argvs, interpret, invocations } from "./helpers.ts";

describe("field splitting and globs", () => {
    test("unquoted expansion splits on IFS", () => {
        expect(argvs("echo $P", { cwd: "/w", env: { P: "a  b\tc" } })).toEqual([
            ["echo", "a", "b", "c"],
        ]);
    });

    test("a known IFS value is honored", () => {
        expect(argvs("echo $P", { cwd: "/w", env: { P: "a,b", IFS: "," } })).toEqual([
            ["echo", "a", "b"],
        ]);
    });

    test("an unknown IFS makes splitting unknown", () => {
        const result = interpret("echo $P", { cwd: "/w", complete: false });
        const arg = result.invocations[0]?.argv[1];
        expect(arg?.value).toBeUndefined();
        expect(arg?.field.count).toBeUndefined();
    });

    test("unquoted glob characters are flagged (not expanded)", () => {
        const result = interpret("echo *.py", { cwd: "/w" });
        const arg = result.invocations[0]?.argv[1];
        expect(arg?.value).toBe("*.py");
        expect(arg?.glob).toBe(true);
    });

    test("quoted glob characters are not flagged", () => {
        const result = interpret('echo "*.py"', { cwd: "/w" });
        expect(result.invocations[0]?.argv[1]?.glob).toBe(false);
    });
});

describe("parameter operators", () => {
    const e = { cwd: "/w", env: { P: "abcdef" } };

    test("substring", () => {
        expect(argvs("echo ${P:1:2}", e)).toEqual([["echo", "bc"]]);
    });

    test("case conversion", () => {
        expect(argvs("echo ${P^^}", e)).toEqual([["echo", "ABCDEF"]]);
        expect(argvs("echo ${P,,}", { cwd: "/w", env: { P: "ABC" } })).toEqual([
            ["echo", "abc"],
        ]);
    });

    test("prefix and suffix removal", () => {
        expect(argvs("echo ${P#a}", e)).toEqual([["echo", "bcdef"]]);
        expect(argvs("echo ${P%f}", e)).toEqual([["echo", "abcde"]]);
        expect(argvs("echo ${Q##*/}", { cwd: "/w", env: { Q: "/a/b/c" } })).toEqual([
            ["echo", "c"],
        ]);
    });

    test("nested default", () => {
        expect(argvs("echo ${X:-${Y:-z}}", { cwd: "/w" })).toEqual([["echo", "z"]]);
    });

    test("assignment default", () => {
        const views = invocations("echo ${X:=hi}; echo $X", { cwd: "/w" });
        expect(views.map((v) => v.argv)).toEqual([
            ["echo", "hi"],
            ["echo", "hi"],
        ]);
    });

    test("${#P} length", () => {
        expect(argvs("echo ${#P}", e)).toEqual([["echo", "6"]]);
    });
});

describe("special parameters and functions", () => {
    test('"$@" binds function arguments', () => {
        expect(argvs('f() { echo "$@"; }; f a b c', { cwd: "/w" })).toEqual([
            ["f", "a", "b", "c"],
            ["echo", "a", "b", "c"],
        ]);
    });

    test("$1 and $# inside a function", () => {
        expect(argvs("f() { echo $1 $#; }; f a b", { cwd: "/w" })).toEqual([
            ["f", "a", "b"],
            ["echo", "a", "2"],
        ]);
    });

    test("$@ is unknown at top level", () => {
        const result = interpret('echo "$@"', { cwd: "/w" });
        expect(result.invocations[0]?.argv[1]?.value).toBeUndefined();
    });
});

describe("variables", () => {
    test("unset removes a variable", () => {
        expect(argvs("unset P; echo $P", { cwd: "/w", env: { P: "x" } })).toEqual([
            ["unset", "P"],
            ["echo"],
        ]);
    });

    test("append assignment", () => {
        expect(argvs("A=x; A+=y; echo $A", { cwd: "/w" })).toEqual([["echo", "xy"]]);
    });

    test("array subscript is unknown", () => {
        expect(argvs("A=(x y); echo ${A[0]}", { cwd: "/w" })).toEqual([
            ["echo", undefined],
        ]);
    });

    test("read leaves its target unknown", () => {
        expect(argvs("read -r name; echo $name", { cwd: "/w" })).toEqual([
            ["read", "-r", "name"],
            ["echo", undefined],
        ]);
    });

    test("printf -v leaves its target unknown", () => {
        expect(argvs("printf -v out x; echo $out", { cwd: "/w" })).toEqual([
            ["printf", "-v", "out", "x"],
            ["echo", undefined],
        ]);
    });

    test("a prefix assignment does not swallow a builtin's effect", () => {
        expect(argvs("A=1 export B=2; echo $B", { cwd: "/w" })).toEqual([
            ["export", "B=2"],
            ["echo", "2"],
        ]);
        const views = invocations("A=1 cd /x; pwd", { cwd: "/w" });
        expect(views.at(-1)?.cwd).toBe("/x");
    });
});

describe("heredocs", () => {
    test("an unquoted heredoc body is expanded and recorded", () => {
        const result = interpret("cat <<EOF\n$HOME/x\nEOF", {
            cwd: "/w",
            env: { HOME: "/home/u" },
        });
        expect(result.invocations.map((i) => i.argv.map((a) => a.value))).toEqual([
            ["cat"],
        ]);
        const home = result.bindings.find((b) => b.name === "HOME") as Binding;
        const uses = result.uses.get(home);
        expect(uses?.some((use) => use.site.kind === "redirect")).toBe(true);
    });

    test("a command substitution in a heredoc runs first", () => {
        const views = invocations("cat <<EOF\n$(python inner.py)\nEOF", {
            cwd: "/w",
        });
        expect(views.map((v) => v.argv[0])).toEqual(["python", "cat"]);
    });

    test("heredoc into bash becomes a nested document", () => {
        const views = invocations("bash <<'EOF'\ncd /srv && python x\nEOF", {
            cwd: "/w",
        });
        expect(views.map((v) => [v.kind, v.argv[0], v.cwd])).toEqual([
            ["external", "bash", "/w"],
            ["builtin", "cd", "/w"],
            ["external", "python", "/srv"],
        ]);
    });
});
