import { describe, expect, test } from "bun:test";

import type { Invocation } from "../../src/interp/index.ts";
import { argvs, interpret, invocations } from "./helpers.ts";

function envState(invocation: Invocation, name: string) {
    return invocation.env.lookup(name);
}

describe("argv wrappers peel to the effective command", () => {
    test("timeout / nice / time / nohup", () => {
        expect(argvs("timeout -s KILL -k 2 10 python x", { cwd: "/w" })).toEqual([
            ["python", "x"],
        ]);
        expect(argvs("nice -n 5 python x", { cwd: "/w" })).toEqual([["python", "x"]]);
        expect(argvs("/usr/bin/time -v python x", { cwd: "/w" })).toEqual([
            ["python", "x"],
        ]);
        expect(argvs("nohup python x", { cwd: "/w" })).toEqual([["python", "x"]]);
    });

    test("unknown options do not unwrap", () => {
        const views = invocations("timeout --frobnicate 5 python x", { cwd: "/w" });
        expect(views[0]?.argv[0]).toBe("timeout");
        expect(views[0]?.wrappers).toEqual([]);
    });

    test("exec / command / builtin", () => {
        expect(invocations("exec python x", { cwd: "/w" })[0]?.wrappers).toEqual([
            "exec",
        ]);
        expect(invocations("command python x", { cwd: "/w" })[0]?.wrappers).toEqual([
            "command",
        ]);
        const builtin = invocations("builtin cd /x", { cwd: "/w" });
        expect(builtin[0]?.kind).toBe("builtin");
        expect(builtin[0]?.argv).toEqual(["cd", "/x"]);
    });

    test("env -i hides the parent environment and sets the listed vars", () => {
        const invocation = interpret("env -i FOO=1 python x", {
            cwd: "/w",
            env: { KEEP: "1" },
        }).invocations[0] as Invocation;
        expect(invocation.argv.map((a) => a.value)).toEqual(["python", "x"]);
        expect(envState(invocation, "FOO")).toEqual({ kind: "set", value: "1" });
        expect(envState(invocation, "KEEP")).toEqual({ kind: "unset" });
    });

    test("env NAME=value and -u", () => {
        const invocation = interpret("env -u GONE FOO=1 python x", {
            cwd: "/w",
            env: { GONE: "x" },
        }).invocations[0] as Invocation;
        expect(invocation.argv.map((a) => a.value)).toEqual(["python", "x"]);
        expect(envState(invocation, "FOO")).toEqual({ kind: "set", value: "1" });
        expect(envState(invocation, "GONE")).toEqual({ kind: "unset" });
    });

    test("sudo without -E hides the environment, with -E keeps it", () => {
        const hidden = interpret("sudo python x", {
            cwd: "/w",
            env: { KEEP: "1" },
        }).invocations[0] as Invocation;
        expect(envState(hidden, "KEEP")).toEqual({ kind: "unknown" });

        const kept = interpret("sudo -E python x", {
            cwd: "/w",
            env: { KEEP: "1" },
        }).invocations[0] as Invocation;
        expect(envState(kept, "KEEP")).toEqual({ kind: "set", value: "1" });
    });
});

describe("script wrappers", () => {
    test("eval of a known string nests", () => {
        const views = invocations("eval 'cd /srv && python x'", { cwd: "/w" });
        expect(views.map((v) => [v.kind, v.argv[0], v.cwd])).toEqual([
            ["builtin", "eval", "/w"],
            ["builtin", "cd", "/w"],
            ["external", "python", "/srv"],
        ]);
    });

    test("watch runs its args via sh", () => {
        const views = invocations("watch -n 2 'cd /srv && ls'", { cwd: "/w" });
        expect(views.map((v) => [v.argv[0], v.cwd])).toEqual([
            ["watch", "/w"],
            ["cd", "/w"],
            ["ls", "/srv"],
        ]);
    });

    test("flock -c runs a script", () => {
        const views = invocations("flock -c 'python x'", { cwd: "/w" });
        expect(views.map((v) => v.argv[0])).toEqual(["flock", "python"]);
    });

    test("flock FILE cmd runs argv", () => {
        const views = invocations("flock /tmp/l python x", { cwd: "/w" });
        expect(views).toHaveLength(1);
        expect(views[0]?.argv).toEqual(["python", "x"]);
        expect(views[0]?.wrappers).toEqual(["flock"]);
    });
});

describe("remote wrappers", () => {
    test("direnv exec changes cwd", () => {
        const views = invocations("direnv exec /proj python x", { cwd: "/w" });
        expect(views[0]?.cwd).toBe("/proj");
        expect(views[0]?.host).toBe("local");
    });

    test("docker run passes -w and -e", () => {
        const views = invocations("docker run --rm -e FOO=1 -w /app image python x", {
            cwd: "/w",
        });
        expect(views[0]?.argv).toEqual(["python", "x"]);
        expect(views[0]?.cwd).toBe("/app");
        expect(views[0]?.host).toBe("remote:docker:image");
    });

    test("docker run --entrypoint does not unwrap", () => {
        const views = invocations("docker run --entrypoint /bin/sh image python x", {
            cwd: "/w",
        });
        expect(views[0]?.argv[0]).toBe("docker");
    });

    test("docker exec combined -it", () => {
        const views = invocations("docker exec -it ctr python x", { cwd: "/w" });
        expect(views[0]?.argv).toEqual(["python", "x"]);
        expect(views[0]?.host).toBe("remote:docker:ctr");
    });

    test("kubectl exec without -- does not unwrap", () => {
        const views = invocations("kubectl exec pod python x", { cwd: "/w" });
        expect(views[0]?.argv[0]).toBe("kubectl");
    });
});

describe("find and xargs", () => {
    test("find -exec with an escaped terminator", () => {
        expect(argvs("find . -name '*.py' -exec python {} \\;", { cwd: "/w" })).toEqual(
            [["python", "{}"]],
        );
    });

    test("find with several -exec", () => {
        expect(argvs("find . -exec a {} \\; -exec b {} \\;", { cwd: "/w" })).toEqual([
            ["a", "{}"],
            ["b", "{}"],
        ]);
    });

    test("xargs skips its options", () => {
        expect(argvs("xargs -0 -n1 -I{} python {}", { cwd: "/w" })).toEqual([
            ["python", "{}"],
        ]);
    });
});

describe("process substitution", () => {
    test("inner commands run first", () => {
        const views = invocations("diff <(a) <(b)", { cwd: "/w" });
        expect(views.map((v) => v.argv[0])).toEqual(["a", "b", "diff"]);
    });
});
