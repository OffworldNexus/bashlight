import { describe, expect, test } from "bun:test";

import {
    interpreterVersion,
    isPipCommand,
    isPipInstallOrUninstall,
    isPythonInterpreter,
    isVenvModule,
    knownPythonPackage,
    parsePythonCommand,
    pipSubcommand,
    shebangManager,
    shebangPythonBase,
} from "../../src/rules/knowledge/python-command-line.ts";
import type { ResolvedScript } from "../../src/rules/knowledge/script-resolver.ts";
import type { CallArg } from "../../src/rules/rule.ts";

function args(...values: (string | undefined)[]): CallArg[] {
    return values.map((value) =>
        value === undefined
            ? { value: undefined, origin: "unknown" }
            : { value, origin: "literal" },
    );
}

describe("parsePythonCommand", () => {
    test("bare interpreters", () => {
        expect(parsePythonCommand(args("python"))).toEqual({
            runner: { kind: "bare" },
            tool: "python",
            toolIndex: 0,
            viaModule: false,
        });
        expect(parsePythonCommand(args("python3", "x.py"))?.tool).toBe("python");
        expect(parsePythonCommand(args("python3.12", "x.py"))?.tool).toBe("python");
    });

    test("python2 and non-python commands are undefined", () => {
        expect(parsePythonCommand(args("python2"))).toBeUndefined();
        expect(parsePythonCommand(args("node"))).toBeUndefined();
        expect(parsePythonCommand(args())).toBeUndefined();
    });

    test("bare tools and pip variants", () => {
        expect(parsePythonCommand(args("pytest", "-q"))?.tool).toBe("pytest");
        expect(parsePythonCommand(args("pip3.11", "list"))?.tool).toBe("pip3.11");
        expect(parsePythonCommand(args("django-admin", "startapp", "x"))?.tool).toBe(
            "django-admin",
        );
    });

    test("python -m exposes the module and the interpreter index", () => {
        expect(parsePythonCommand(args("python", "-m", "pytest", "-q"))).toEqual({
            runner: { kind: "bare" },
            tool: "pytest",
            toolIndex: 0,
            viaModule: true,
        });
    });

    test("manager runners", () => {
        expect(parsePythonCommand(args("poetry", "run", "pytest"))?.runner).toEqual({
            kind: "manager",
            manager: "poetry",
            length: 2,
            hasOptions: false,
        });
        expect(
            parsePythonCommand(args("poetry", "-C", "api", "run", "pytest"))?.runner,
        ).toEqual({ kind: "manager", manager: "poetry", length: 4, hasOptions: true });
        expect(
            parsePythonCommand(args("uv", "run", "--with", "x", "--no-sync", "python"))
                ?.runner,
        ).toEqual({ kind: "manager", manager: "uv", length: 5, hasOptions: true });
        expect(parsePythonCommand(args("pipenv", "run", "pytest"))?.runner).toEqual({
            kind: "manager",
            manager: "pipenv",
            length: 2,
            hasOptions: false,
        });
        expect(parsePythonCommand(args("hatch", "run", "pytest"))?.runner).toEqual({
            kind: "manager",
            manager: "hatch",
            length: 2,
            hasOptions: false,
        });
    });

    test("uv pip is its own prefix", () => {
        const parsed = parsePythonCommand(args("uv", "pip", "install", "x"));
        expect(parsed?.runner).toEqual({
            kind: "manager",
            manager: "uv",
            length: 1,
            hasOptions: false,
        });
        expect(parsed?.tool).toBe("pip");
    });

    test("uv add and unknown uv options are undefined", () => {
        expect(parsePythonCommand(args("uv", "add", "x"))).toBeUndefined();
        expect(
            parsePythonCommand(args("uv", "run", "--frobnicate", "x")),
        ).toBeUndefined();
    });

    test("explicit paths", () => {
        const venv = parsePythonCommand(args(".venv/bin/python", "x.py"));
        expect(venv?.runner).toEqual({
            kind: "path",
            directory: ".venv/bin",
            isVenvBin: true,
        });
        expect(venv?.tool).toBe("python");
        expect(parsePythonCommand(args(".venv/bin/pytest"))?.tool).toBe("pytest");
        expect(parsePythonCommand(args("/usr/bin/python3"))?.runner).toEqual({
            kind: "path",
            directory: "/usr/bin",
            isVenvBin: false,
        });
        expect(parsePythonCommand(args("./scripts/run.py"))).toBeUndefined();
    });
});

describe("python-command-line helpers", () => {
    test("interpreter and version detection", () => {
        expect(isPythonInterpreter("python")).toBe(true);
        expect(isPythonInterpreter("python3.10")).toBe(true);
        expect(isPythonInterpreter("python2")).toBe(false);
        expect(interpreterVersion("python3.10")).toBe("3.10");
        expect(interpreterVersion("python3")).toBeUndefined();
    });

    test("tool packages", () => {
        expect(knownPythonPackage("pytest")).toBe("pytest");
        expect(knownPythonPackage("django-admin")).toBe("django");
        expect(knownPythonPackage("pip3")).toBe("pip");
        expect(knownPythonPackage("unknown-tool")).toBeUndefined();
        expect(isVenvModule("venv")).toBe(true);
    });

    test("pip command detection and subcommands", () => {
        const command = parsePythonCommand(args("python", "-m", "pip", "install", "x"));
        expect(command).toBeDefined();
        if (command === undefined) {
            return;
        }
        expect(isPipCommand(command)).toBe(true);
        expect(
            pipSubcommand(args("python", "-m", "pip", "install", "x"), command),
        ).toEqual({
            pipIndex: 2,
            index: 3,
            name: "install",
        });
        expect(
            isPipInstallOrUninstall(
                args("python", "-m", "pip", "install", "x"),
                command,
            ),
        ).toBe(true);
    });
});

function script(interpreter: string, viaEnv: boolean): ResolvedScript {
    return {
        path: "/w/x",
        shebang: { interpreter, args: [], viaEnv, raw: "#!/x" },
    };
}

describe("python-command-line scripts", () => {
    test("a python shebang is a script command", () => {
        const command = parsePythonCommand(args("./x"), script("python3", true));
        expect(command?.runner.kind).toBe("script");
        expect(command?.tool).toBe("python");
        expect(
            parsePythonCommand(args("./x"), script("/usr/bin/python3", false))?.runner
                .kind,
        ).toBe("script");
    });

    test("a runner shebang is a script command too", () => {
        expect(parsePythonCommand(args("./x"), script("uv", true))?.runner.kind).toBe(
            "script",
        );
    });

    test("other shebangs are not python commands", () => {
        expect(parsePythonCommand(args("./x"), script("bash", false))).toBeUndefined();
        expect(parsePythonCommand(args("./x"), script("node", true))).toBeUndefined();
    });

    test("shebang helpers", () => {
        expect(
            shebangPythonBase({
                interpreter: "/usr/bin/python3",
                args: [],
                viaEnv: false,
                raw: "",
            }),
        ).toBe("python3");
        expect(
            shebangPythonBase({ interpreter: "node", args: [], viaEnv: true, raw: "" }),
        ).toBeUndefined();
        expect(
            shebangManager({ interpreter: "uv", args: [], viaEnv: true, raw: "" }),
        ).toBe("uv");
        expect(
            shebangManager({ interpreter: "python3", args: [], viaEnv: true, raw: "" }),
        ).toBeUndefined();
    });
});
