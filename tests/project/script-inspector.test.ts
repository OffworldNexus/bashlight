import { describe, expect, test } from "bun:test";

import {
    MemoryFileSystem,
    parseShebang,
    ShebangScriptInspector,
} from "../../src/project/index.ts";

describe("parseShebang", () => {
    test("keeps an absolute interpreter as written", () => {
        expect(parseShebang("#!/usr/bin/python3")).toEqual({
            interpreter: "/usr/bin/python3",
            args: [],
            viaEnv: false,
            raw: "#!/usr/bin/python3",
        });
        expect(parseShebang("#!/usr/bin/python3 -u")?.args).toEqual(["-u"]);
    });

    test("resolves env interpreters", () => {
        expect(parseShebang("#!/usr/bin/env python3")).toEqual({
            interpreter: "python3",
            args: [],
            viaEnv: true,
            raw: "#!/usr/bin/env python3",
        });
        expect(parseShebang("#!/usr/bin/env python3 -u")).toEqual({
            interpreter: "python3",
            args: ["-u"],
            viaEnv: true,
            raw: "#!/usr/bin/env python3 -u",
        });
    });

    test("handles env -S and env options/assignments", () => {
        expect(parseShebang("#!/usr/bin/env -S uv run --script")).toEqual({
            interpreter: "uv",
            args: ["run", "--script"],
            viaEnv: true,
            raw: "#!/usr/bin/env -S uv run --script",
        });
        expect(parseShebang("#!/usr/bin/env -i -u HOME FOO=bar python3")).toEqual({
            interpreter: "python3",
            args: [],
            viaEnv: true,
            raw: "#!/usr/bin/env -i -u HOME FOO=bar python3",
        });
        expect(parseShebang("#!/usr/bin/env -- python3")?.interpreter).toBe("python3");
    });

    test("tolerates a space after #! and CRLF", () => {
        expect(parseShebang("#! /bin/bash")?.interpreter).toBe("/bin/bash");
        expect(parseShebang("#!/usr/bin/env python3\r\nprint(1)")).toEqual({
            interpreter: "python3",
            args: [],
            viaEnv: true,
            raw: "#!/usr/bin/env python3",
        });
    });

    test("returns undefined for no shebang, empty, binary and bare env", () => {
        expect(parseShebang("print(1)")).toBeUndefined();
        expect(parseShebang("#!")).toBeUndefined();
        expect(parseShebang("#!\u0000binary")).toBeUndefined();
        expect(parseShebang("#!/usr/bin/env")).toBeUndefined();
        expect(parseShebang("\u0000\u0000\u0000")).toBeUndefined();
    });
});

describe("ShebangScriptInspector", () => {
    test("reads shebangs and memoizes misses", () => {
        const fs = new MemoryFileSystem({
            "/w/manage.py": "#!/usr/bin/env python3\nprint(1)\n",
            "/w/bin/cli": "#!/usr/bin/env -S uv run --script\n",
            "/w/no-shebang": "hello\n",
        });
        const inspector = new ShebangScriptInspector(fs);
        expect(inspector.shebang("/w/manage.py")?.interpreter).toBe("python3");
        expect(inspector.shebang("/w/bin/cli")?.args).toEqual(["run", "--script"]);
        expect(inspector.shebang("/w/no-shebang")).toBeUndefined();
        expect(inspector.shebang("/w/missing")).toBeUndefined();
        expect(inspector.shebang("/w/manage.py")).toBe(
            inspector.shebang("/w/manage.py"),
        );
    });

    test("does not read more than maxBytes", () => {
        const fs = new MemoryFileSystem({ "/w/x": "#!/usr/bin/env python3\n" });
        const inspector = new ShebangScriptInspector(fs, 2);
        expect(inspector.shebang("/w/x")).toBeUndefined();
    });
});
