import { describe, expect, test } from "bun:test";

import type { Invocation } from "../../src/interp/index.ts";
import { argvs, interpret, invocations } from "./helpers.ts";

function envState(invocation: Invocation, name: string) {
    return invocation.env.lookup(name);
}

describe("word expansion", () => {
    test("a binding splits into fields and keeps its origin", () => {
        const command = 'P="poetry run python"; $P a.py; $P b.py';
        const result = interpret(command, { cwd: "/w", env: { HOME: "/home/u" } });
        expect(
            result.invocations.map((invocation) =>
                invocation.argv.map((arg) => arg.value),
            ),
        ).toEqual([
            ["poetry", "run", "python", "a.py"],
            ["poetry", "run", "python", "b.py"],
        ]);
        const first = result.invocations[0] as Invocation;
        expect(first.argv[0]?.field).toEqual({ index: 0, count: 3 });
        expect(first.argv[1]?.field).toEqual({ index: 1, count: 3 });
        expect(first.argv[2]?.field).toEqual({ index: 2, count: 3 });
        expect(first.argv[3]?.field).toEqual({ index: 0, count: 1 });
        expect(first.argv[0]?.fragments[0]?.origin.kind).toBe("binding");
        expect(first.argv[3]?.fragments[0]?.origin.kind).toBe("literal");

        const bindings = result.bindings.filter((binding) => binding.name === "P");
        expect(bindings).toHaveLength(1);
        const uses = result.uses.get(bindings[0] as never);
        expect(uses?.length).toBe(2);
        expect(uses?.[0]?.site.kind).toBe("argv");
    });

    test('"$P" is one field', () => {
        expect(argvs('echo "$P"', { cwd: "/w", env: { P: "a b" } })).toEqual([
            ["echo", "a b"],
        ]);
    });

    test("unquoted empty expansion produces no argument", () => {
        expect(argvs("echo $EMPTY", { cwd: "/w", env: {} })).toEqual([["echo"]]);
        expect(argvs('echo "$EMPTY"', { cwd: "/w", env: {} })).toEqual([["echo", ""]]);
    });

    test("${P:-x} default", () => {
        expect(argvs("echo ${P:-x}", { cwd: "/w", env: {} })).toEqual([["echo", "x"]]);
        expect(argvs("echo ${P:-x}", { cwd: "/w", env: { P: "v" } })).toEqual([
            ["echo", "v"],
        ]);
    });

    test("brace expansion yields several args", () => {
        expect(argvs("echo {a,b}.py", { cwd: "/w", env: {} })).toEqual([
            ["echo", "a.py", "b.py"],
        ]);
    });

    test("tilde uses HOME", () => {
        expect(argvs("ls ~/x", { cwd: "/w", env: { HOME: "/home/u" } })).toEqual([
            ["ls", "/home/u/x"],
        ]);
        expect(argvs("ls ~/x", { cwd: "/w", env: {} })).toEqual([["ls", undefined]]);
    });

    test("${#P} and ${P/a/b} and arithmetic", () => {
        expect(argvs("echo ${#P}", { cwd: "/w", env: { P: "abcd" } })).toEqual([
            ["echo", "4"],
        ]);
        expect(argvs("echo ${P/a/b}", { cwd: "/w", env: { P: "xax" } })).toEqual([
            ["echo", "xbx"],
        ]);
        expect(argvs("echo $((1 + 2 * 3))", { cwd: "/w", env: {} })).toEqual([
            ["echo", "7"],
        ]);
    });

    test("export makes a variable usable", () => {
        expect(
            argvs('export P="poetry run python"; $P a.py', { cwd: "/w", env: {} }),
        ).toEqual([
            ["export", "P=poetry run python"],
            ["poetry", "run", "python", "a.py"],
        ]);
    });
});

describe("environment and cwd", () => {
    test("cd then command", () => {
        const views = invocations("cd api && python x", { cwd: "/w" });
        expect(views.map((v) => [v.argv[0], v.cwd])).toEqual([
            ["cd", "/w"],
            ["python", "/w/api"],
        ]);
    });

    test("cd .. normalizes", () => {
        expect(argvs("cd /a; cd ..; pwd", { cwd: "/w" })).toEqual([
            ["cd", "/a"],
            ["cd", ".."],
            ["pwd"],
        ]);
        const views = invocations("cd /a; cd ..; pwd", { cwd: "/w" });
        expect(views[2]?.cwd).toBe("/");
    });

    test("cd with unknown target makes cwd unknown", () => {
        const views = invocations("cd $(git rev-parse --show-toplevel) && x", {
            cwd: "/w",
        });
        expect(views.map((v) => v.argv[0])).toEqual(["git", "cd", "x"]);
        expect(views[2]?.cwd).toBeUndefined();
    });

    test("subshell cwd is restored", () => {
        const views = invocations("(cd x && a); b", { cwd: "/w" });
        expect(views.map((v) => [v.argv[0], v.cwd])).toEqual([
            ["cd", "/w"],
            ["a", "/w/x"],
            ["b", "/w"],
        ]);
    });

    test("pipeline member cwd is not changed", () => {
        const views = invocations("cd x | cat; y", { cwd: "/w" });
        expect(views.find((v) => v.argv[0] === "y")?.cwd).toBe("/w");
    });

    test("prefix assignment does not leak", () => {
        const result = interpret("A=1 cmd; echo $A", { cwd: "/w", env: {} });
        expect(result.invocations.map((i) => i.argv.map((a) => a.value))).toEqual([
            ["cmd"],
            ["echo"],
        ]);
        const cmd = result.invocations[0] as Invocation;
        expect(envState(cmd, "A")).toEqual({ kind: "set", value: "1" });
        const echo = result.invocations[1] as Invocation;
        expect(envState(echo, "A")).toEqual({ kind: "unset" });
    });

    test("source activate sets VIRTUAL_ENV", () => {
        const views = invocations("source .venv/bin/activate && python x", {
            cwd: "/w",
        });
        expect(views.map((v) => v.argv[0])).toEqual(["source", "python"]);
        const python = views[1];
        expect(python?.cwd).toBe("/w");
    });
});

describe("wrappers", () => {
    test("sudo/env/timeout/nice peel to the effective command", () => {
        const views = invocations("sudo -E env FOO=1 timeout 10 nice -n 5 python x", {
            cwd: "/w",
        });
        expect(views).toHaveLength(1);
        expect(views[0]?.argv).toEqual(["python", "x"]);
        expect(views[0]?.wrappers).toEqual(["sudo", "env", "timeout", "nice"]);
    });

    test("bash -c nests a document", () => {
        const views = invocations("bash -lc 'cd api && pytest -x'", { cwd: "/w" });
        expect(views.map((v) => [v.kind, v.argv[0], v.cwd])).toEqual([
            ["external", "bash", "/w"],
            ["builtin", "cd", "/w"],
            ["external", "pytest", "/w/api"],
        ]);
    });

    test("ssh joins args and runs remotely", () => {
        const views = invocations(
            "ssh -o X=y user@host 'cd /srv && python manage.py migrate'",
            { cwd: "/w" },
        );
        expect(views.map((v) => [v.argv[0], v.host, v.cwd])).toEqual([
            ["ssh", "local", "/w"],
            ["cd", "remote:ssh:user@host", undefined],
            ["python", "remote:ssh:user@host", "/srv"],
        ]);
    });

    test("ssh host bash -s reads the heredoc", () => {
        const views = invocations("ssh host bash -s <<'EOF'\npython x.py\nEOF", {
            cwd: "/w",
        });
        expect(views.map((v) => v.argv.slice(0, 2))).toEqual([
            ["ssh", "host"],
            ["bash", "-s"],
            ["python", "x.py"],
        ]);
        expect(views[2]?.host).toBe("remote:ssh:host");
    });

    test("docker compose exec", () => {
        const views = invocations(
            'docker compose exec -T api python manage.py shell -c "print(1)"',
            { cwd: "/w" },
        );
        expect(views).toHaveLength(1);
        expect(views[0]?.argv).toEqual([
            "python",
            "manage.py",
            "shell",
            "-c",
            "print(1)",
        ]);
        expect(views[0]?.host).toBe("remote:docker:api");
    });

    test("kubectl exec", () => {
        const views = invocations("kubectl exec -it pod -- python x", { cwd: "/w" });
        expect(views[0]?.argv).toEqual(["python", "x"]);
        expect(views[0]?.host).toBe("remote:kubectl:pod");
    });

    test("eval of an unknown string does not nest", () => {
        const result = interpret('eval "$CMD"', { cwd: "/w", complete: false });
        expect(result.invocations).toHaveLength(1);
        expect(result.invocations[0]?.kind).toBe("builtin");
    });

    test("command -v does not nest", () => {
        const views = invocations("command -v python", { cwd: "/w" });
        expect(views).toHaveLength(1);
        expect(views[0]?.argv).toEqual(["command", "-v", "python"]);
        expect(views[0]?.kind).toBe("builtin");
    });
});

describe("control flow", () => {
    test("for loop binds its single item", () => {
        expect(argvs("for f in a.py; do python $f; done", { cwd: "/w" })).toEqual([
            ["python", "a.py"],
        ]);
    });

    test("if branches merge to unknown cwd", () => {
        const views = invocations("if x; then cd a; else cd b; fi; y", { cwd: "/w" });
        expect(views.at(-1)?.argv[0]).toBe("y");
        expect(views.at(-1)?.cwd).toBeUndefined();
    });

    test("function call runs its body at the call site", () => {
        const views = invocations("f() { cd /srv; python x; }; f", { cwd: "/w" });
        expect(views.map((v) => [v.kind, v.argv[0], v.cwd])).toEqual([
            ["function", "f", "/w"],
            ["builtin", "cd", "/w"],
            ["external", "python", "/srv"],
        ]);
    });

    test("never-called functions are visited speculatively", () => {
        const views = invocations("f() { python x; }", { cwd: "/w" });
        expect(views).toHaveLength(1);
        expect(views[0]?.argv[0]).toBe("python");
        expect(views[0]?.speculative).toBe(true);
    });

    test("command substitution runs before its command", () => {
        const views = invocations("$(python -c 'print(1)')", { cwd: "/w" });
        expect(views.map((v) => v.argv[0])).toEqual(["python", undefined]);
    });
});

describe("misc", () => {
    test("array assignment makes the variable unknown", () => {
        expect(argvs("A=(x y); echo ${A[0]}", { cwd: "/w" })).toEqual([
            ["echo", undefined],
        ]);
    });

    test("cd - uses OLDPWD", () => {
        const views = invocations("cd /a; cd /b; cd -; pwd", { cwd: "/w" });
        expect(views.at(-1)?.cwd).toBe("/a");
    });

    test("interpret never throws on garbage", () => {
        expect(() => interpret("if (", { cwd: "/w" })).not.toThrow();
        const result = interpret("if (", { cwd: "/w" });
        expect(result.parse.ok).toBe(false);
        expect(result.invocations).toEqual([]);
    });
});
