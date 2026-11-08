import { describe, expect, test } from "bun:test";

import type { Invocation } from "../../src/interp/index.ts";
import { argvs, interpret, invocations } from "./helpers.ts";

function envState(invocation: Invocation, name: string) {
    return invocation.env.lookup(name);
}

describe("brace expansion order", () => {
    test("prefix, alternative, suffix", () => {
        expect(argvs("echo src/{a,b}", { cwd: "/w" })).toEqual([
            ["echo", "src/a", "src/b"],
        ]);
        expect(argvs("echo a{1,2}b", { cwd: "/w" })).toEqual([["echo", "a1b", "a2b"]]);
    });

    test("nested braces", () => {
        expect(argvs("echo {a,b{c,d}}", { cwd: "/w" })).toEqual([
            ["echo", "a", "bc", "bd"],
        ]);
    });

    test("several brace groups in one word", () => {
        expect(argvs("echo {a,b}{1,2}", { cwd: "/w" })).toEqual([
            ["echo", "a1", "a2", "b1", "b2"],
        ]);
    });
});

describe("&& and || modelling", () => {
    test("success path runs sequentially", () => {
        const views = invocations("mkdir x && cd x && python y", { cwd: "/w" });
        expect(views.at(-1)?.argv[0]).toBe("python");
        expect(views.at(-1)?.cwd).toBe("/w/x");
    });

    test("a terminating failure exit is excluded", () => {
        const views = invocations("cd x || exit 1; pwd", { cwd: "/w" });
        expect(views.at(-1)?.cwd).toBe("/w/x");
    });

    test("an && exit makes the state after the chain unknown", () => {
        const views = invocations("cd api && pytest; ls", { cwd: "/w" });
        const pytest = views.find((v) => v.argv[0] === "pytest");
        expect(pytest?.cwd).toBe("/w/api");
        expect(views.at(-1)?.cwd).toBeUndefined();
    });

    test("false || cd a leaves the cwd unknown", () => {
        const views = invocations("false || cd a; pwd", { cwd: "/w" });
        expect(views.at(-1)?.cwd).toBeUndefined();
    });

    test("false && cd a leaves the cwd unknown", () => {
        const views = invocations("false && cd a; pwd", { cwd: "/w" });
        expect(views.at(-1)?.cwd).toBeUndefined();
    });

    test("false || A=1 leaves the variable unknown", () => {
        const views = invocations("false || A=1; echo $A", { cwd: "/w" });
        expect(views.at(-1)?.argv).toEqual(["echo", undefined]);
    });

    test("a chain of cds keeps the success-path cwd", () => {
        const views = invocations("cd /a && cd b && x", { cwd: "/w" });
        expect(views.at(-1)?.cwd).toBe("/a/b");
    });
});

describe("quoted empty words", () => {
    test("a quoted empty word is one empty field", () => {
        expect(argvs('echo ""', { cwd: "/w" })).toEqual([["echo", ""]]);
        expect(argvs("echo ''", { cwd: "/w" })).toEqual([["echo", ""]]);
        expect(argvs("echo $''", { cwd: "/w" })).toEqual([["echo", ""]]);
        expect(argvs('echo "${U-}"', { cwd: "/w" })).toEqual([["echo", ""]]);
        expect(argvs('echo "$EMPTY"', { cwd: "/w" })).toEqual([["echo", ""]]);
    });

    test('"$@" with no positionals yields no field', () => {
        expect(argvs('f() { echo "$@"; }; f', { cwd: "/w" })).toEqual([
            ["f"],
            ["echo"],
        ]);
    });
});

describe("function frames", () => {
    test("local is restored on return", () => {
        const views = invocations("A=old; f() { local A=1; echo $A; }; f; echo $A", {
            cwd: "/w",
        });
        expect(views.map((v) => v.argv)).toEqual([
            ["f"],
            ["local", "A=1"],
            ["echo", "1"],
            ["echo", "old"],
        ]);
    });

    test("declare without -g is restored", () => {
        const views = invocations("f() { declare B=2; }; f; echo $B", { cwd: "/w" });
        expect(views.at(-1)?.argv).toEqual(["echo"]);
    });

    test("declare -g survives", () => {
        const views = invocations("f() { declare -g C=3; }; f; echo $C", { cwd: "/w" });
        expect(views.at(-1)?.argv).toEqual(["echo", "3"]);
    });
});

describe("exec-style wrappers", () => {
    test("a builtin under timeout cannot change the shell", () => {
        expect(invocations("timeout 5 cd /; pwd", { cwd: "/w" }).at(-1)?.cwd).toBe(
            "/w",
        );
        expect(invocations("nice -n 5 cd /; pwd", { cwd: "/w" }).at(-1)?.cwd).toBe(
            "/w",
        );
    });

    test("command keeps acting on the shell", () => {
        expect(invocations("command cd /; pwd", { cwd: "/w" }).at(-1)?.cwd).toBe("/");
    });
});

describe("function precedence", () => {
    test("a function shadows cd and a wrapper", () => {
        const views = invocations("cd() { echo custom; }; cd /x; pwd", { cwd: "/w" });
        expect(views[0]?.kind).toBe("function");
        expect(views[0]?.argv).toEqual(["cd", "/x"]);
        expect(views.at(-1)?.cwd).toBe("/w");

        const envViews = invocations("env() { echo e; }; env FOO=1", { cwd: "/w" });
        expect(envViews[0]?.kind).toBe("function");
        expect(envViews[0]?.argv).toEqual(["env", "FOO=1"]);
    });
});

describe("heredocs", () => {
    test("a heredoc feeding a shell is expanded once", () => {
        const views = invocations("bash <<EOF\n$(python inner.py)\nEOF", { cwd: "/w" });
        expect(views.filter((v) => v.argv[0] === "python")).toHaveLength(1);
    });

    test("the same over ssh", () => {
        const views = invocations("ssh host bash -s <<EOF\n$(python inner.py)\nEOF", {
            cwd: "/w",
        });
        expect(views.filter((v) => v.argv[0] === "python")).toHaveLength(1);
    });
});

describe("word splitting", () => {
    test("unquoted $* joins with the first IFS char then splits", () => {
        const views = invocations("f() { echo $*; }; f a b", {
            cwd: "/w",
            env: { IFS: "," },
        });
        expect(views.at(-1)?.argv).toEqual(["echo", "a", "b"]);
    });

    test("empty fields between non-whitespace IFS delimiters are kept", () => {
        expect(argvs("v=a::b; echo $v", { cwd: "/w", env: { IFS: ":" } })).toEqual([
            ["echo", "a", "", "b"],
        ]);
    });

    test("assignment values do not undergo brace expansion", () => {
        expect(argvs("X=a{1,2}; echo $X", { cwd: "/w" })).toEqual([["echo", "a{1,2}"]]);
    });
});

describe("builtins", () => {
    test("export -n A=9 assigns and unexports", () => {
        const result = interpret("export -n A=9; echo $A", { cwd: "/w" });
        expect(result.invocations.map((i) => i.argv.map((a) => a.value))).toEqual([
            ["export", "-n", "A=9"],
            ["echo", "9"],
        ]);
        const echo = result.invocations.at(-1) as Invocation;
        expect(envState(echo, "A")).toEqual({ kind: "set", value: "9" });
    });

    test("cd with a glob makes the cwd unknown", () => {
        expect(
            invocations("cd /tmp/*; pwd", { cwd: "/w" }).at(-1)?.cwd,
        ).toBeUndefined();
    });

    test("deactivate reverts the prepended PATH", () => {
        const views = invocations("source .venv/bin/activate; deactivate; echo $PATH", {
            cwd: "/w",
            env: { PATH: "/usr/bin:/bin" },
        });
        expect(views.at(-1)?.argv).toEqual(["echo", "/usr/bin:/bin"]);
    });

    test("unset makes a name unset even when the environment is incomplete", () => {
        expect(argvs("unset A; echo $A", { cwd: "/w", complete: false })).toEqual([
            ["unset", "A"],
            ["echo"],
        ]);
    });

    test("${X:=hi} assigns and is visible afterwards", () => {
        expect(argvs("echo ${X:=hi}; echo $X", { cwd: "/w" })).toEqual([
            ["echo", "hi"],
            ["echo", "hi"],
        ]);
    });
});

describe("redirect stdin detection", () => {
    test("a heredoc on fd 2 does not feed the shell", () => {
        const views = invocations("bash 2<<'EOF'\npython x\nEOF", { cwd: "/w" });
        expect(views).toHaveLength(1);
        expect(views[0]?.argv).toEqual(["bash"]);
    });

    test("a heredoc on stdin does feed the shell", () => {
        expect(invocations("bash <<'EOF'\npython x\nEOF", { cwd: "/w" })).toHaveLength(
            2,
        );
    });
});

describe("xargs trailing option", () => {
    test("with no command, xargs is not peeled", () => {
        const views = invocations("xargs -n", { cwd: "/w" });
        expect(views).toHaveLength(1);
        expect(views[0]?.argv).toEqual(["xargs", "-n"]);
        expect(views[0]?.wrappers).toEqual([]);
    });
});
