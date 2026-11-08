import { describe, expect, test } from "bun:test";

import type { NodeManager } from "../../src/project/index.ts";
import {
    BUN_PROJECT,
    nodeProject,
    NPM_PROJECT,
    PNPM_PROJECT,
    YARN_PROJECT,
} from "./fixtures.ts";
import { given, kept, rewritten } from "./harness.ts";

describe("node-manager — npm project", () => {
    test("pnpm install/ci/add/remove are translated", () => {
        expect(given(NPM_PROJECT).run("pnpm", "install")).toEqual(
            rewritten(["npm", "install"]),
        );
        expect(given(NPM_PROJECT).run("pnpm", "install", "--frozen-lockfile")).toEqual(
            rewritten(["npm", "ci"]),
        );
        expect(given(NPM_PROJECT).run("pnpm", "add", "-D", "x")).toEqual(
            rewritten(["npm", "install", "-D", "x"]),
        );
        expect(given(NPM_PROJECT).run("pnpm", "remove", "x")).toEqual(
            rewritten(["npm", "uninstall", "x"]),
        );
    });

    test("run scripts and lifecycle aliases", () => {
        expect(given(NPM_PROJECT).run("pnpm", "run", "lint")).toEqual(
            rewritten(["npm", "run", "lint"]),
        );
        expect(given(NPM_PROJECT).run("pnpm", "run", "test", "--", "a")).toEqual(
            rewritten(["npm", "run", "test", "--", "a"]),
        );
        expect(given(NPM_PROJECT).run("yarn", "test")).toEqual(
            rewritten(["npm", "run", "test"]),
        );
        expect(given(NPM_PROJECT).run("yarn", "lint")).toEqual(
            rewritten(["npm", "run", "lint"]),
        );
    });

    test("exec of a declared binary uses npx, otherwise npx -y", () => {
        expect(given(NPM_PROJECT).run("pnpm", "exec", "eslint", "--fix")).toEqual(
            rewritten(["npx", "eslint", "--fix"]),
        );
        expect(given(NPM_PROJECT).run("pnpm", "dlx", "foo")).toEqual(
            rewritten(["npx", "-y", "foo"]),
        );
    });

    test("same manager, global and other are kept", () => {
        expect(given(NPM_PROJECT).run("npx", "x")).toEqual(kept);
        expect(given(NPM_PROJECT).run("npm", "install")).toEqual(kept);
        expect(given(NPM_PROJECT).run("pnpm", "install", "-g", "x")).toEqual(kept);
        expect(given(NPM_PROJECT).run("pnpm", "publish")).toEqual(kept);
    });

    test("a lifecycle alias strips a leading --", () => {
        expect(given(NPM_PROJECT).run("yarn", "test", "--", "--watch")).toEqual(
            rewritten(["npm", "run", "test", "--", "--watch"]),
        );
    });
});

describe("node-manager — pnpm project", () => {
    test("npm is translated", () => {
        expect(given(PNPM_PROJECT).run("npm", "install")).toEqual(
            rewritten(["pnpm", "install"]),
        );
        expect(given(PNPM_PROJECT).run("npm", "ci")).toEqual(
            rewritten(["pnpm", "install", "--frozen-lockfile"]),
        );
        expect(given(PNPM_PROJECT).run("npm", "install", "-D", "x")).toEqual(
            rewritten(["pnpm", "add", "-D", "x"]),
        );
        expect(given(PNPM_PROJECT).run("npm", "uninstall", "x")).toEqual(
            rewritten(["pnpm", "remove", "x"]),
        );
        expect(given(PNPM_PROJECT).run("npm", "run", "lint")).toEqual(
            rewritten(["pnpm", "run", "lint"]),
        );
        expect(given(PNPM_PROJECT).run("npm", "test")).toEqual(
            rewritten(["pnpm", "run", "test"]),
        );
    });

    test("npx of a declared binary uses pnpm exec, otherwise dlx", () => {
        expect(given(PNPM_PROJECT).run("npx", "prettier", "--write", ".")).toEqual(
            rewritten(["pnpm", "exec", "prettier", "--write", "."]),
        );
        expect(given(PNPM_PROJECT).run("npx", "nonexistent-tool")).toEqual(
            rewritten(["pnpm", "dlx", "nonexistent-tool"]),
        );
    });

    test("yarn/bun run scripts use pnpm run", () => {
        expect(given(PNPM_PROJECT).run("yarn", "add", "x")).toEqual(
            rewritten(["pnpm", "add", "x"]),
        );
        expect(given(PNPM_PROJECT).run("yarn", "lint")).toEqual(
            rewritten(["pnpm", "run", "lint"]),
        );
        expect(given(PNPM_PROJECT).run("bun", "install")).toEqual(
            rewritten(["pnpm", "install"]),
        );
    });

    test("yarn add without packages is an install", () => {
        expect(given(PNPM_PROJECT).run("yarn", "add")).toEqual(
            rewritten(["pnpm", "install"]),
        );
    });

    test("exec with -p/--package keeps the package", () => {
        expect(given(PNPM_PROJECT).run("npx", "-p", "pkg", "bin")).toEqual(
            rewritten(["pnpm", "dlx", "--package", "pkg", "bin"]),
        );
        expect(given(PNPM_PROJECT).run("npx", "--package", "pkg", "bin")).toEqual(
            rewritten(["pnpm", "dlx", "--package", "pkg", "bin"]),
        );
    });
});

describe("node-manager — yarn project", () => {
    test("npm is translated to yarn", () => {
        expect(given(YARN_PROJECT).run("npm", "install")).toEqual(
            rewritten(["yarn", "install"]),
        );
        expect(given(YARN_PROJECT).run("npm", "ci")).toEqual(
            rewritten(["yarn", "install", "--frozen-lockfile"]),
        );
        expect(given(YARN_PROJECT).run("npm", "install", "-D", "x")).toEqual(
            rewritten(["yarn", "add", "-D", "x"]),
        );
        expect(given(YARN_PROJECT).run("npm", "run", "lint")).toEqual(
            rewritten(["yarn", "run", "lint"]),
        );
    });

    test("pnpm exec/dlx map to classic yarn's npx", () => {
        expect(given(YARN_PROJECT).run("pnpm", "exec", "eslint", "--fix")).toEqual(
            rewritten(["npx", "eslint", "--fix"]),
        );
        expect(given(YARN_PROJECT).run("pnpm", "dlx", "foo")).toEqual(
            rewritten(["npx", "-y", "foo"]),
        );
    });

    test("a berry yarn project uses yarn exec/dlx and --immutable", () => {
        const berry = {
            ...YARN_PROJECT,
            "/w/.yarnrc.yml": "nodeLinker: node-modules\n",
        };
        expect(given(berry).run("npm", "ci")).toEqual(
            rewritten(["yarn", "install", "--immutable"]),
        );
        expect(given(berry).run("pnpm", "exec", "eslint", "--fix")).toEqual(
            rewritten(["yarn", "exec", "eslint", "--fix"]),
        );
        expect(given(berry).run("pnpm", "dlx", "foo")).toEqual(
            rewritten(["yarn", "dlx", "foo"]),
        );
    });
});

describe("node-manager — bun project", () => {
    test("npm is translated to bun", () => {
        expect(given(BUN_PROJECT).run("npm", "install")).toEqual(
            rewritten(["bun", "install"]),
        );
        expect(given(BUN_PROJECT).run("npm", "install", "-D", "x")).toEqual(
            rewritten(["bun", "add", "-d", "x"]),
        );
        expect(given(BUN_PROJECT).run("npm", "install", "-E", "x")).toEqual(
            rewritten(["bun", "add", "--exact", "x"]),
        );
        expect(given(BUN_PROJECT).run("npm", "uninstall", "x")).toEqual(
            rewritten(["bun", "remove", "x"]),
        );
    });

    test("npx and run map to bunx/bun run", () => {
        expect(given(BUN_PROJECT).run("npx", "foo")).toEqual(
            rewritten(["bunx", "foo"]),
        );
        expect(given(BUN_PROJECT).run("yarn", "run", "lint")).toEqual(
            rewritten(["bun", "run", "lint"]),
        );
        expect(given(BUN_PROJECT).run("npm", "run", "test", "--", "a")).toEqual(
            rewritten(["bun", "run", "test", "a"]),
        );
    });
});

describe("node-manager — guards", () => {
    test("no node project means nothing happens", () => {
        expect(given().run("pnpm", "install")).toEqual(kept);
    });

    test("unknown flags are kept", () => {
        expect(given(PNPM_PROJECT).run("npm", "install", "--production")).toEqual(kept);
        expect(given(PNPM_PROJECT).run("npm", "install", "--frozen-lockfile")).toEqual(
            kept,
        );
    });

    test("a global command is never translated", () => {
        expect(given(PNPM_PROJECT).run("npm", "install", "-g", "x")).toEqual(kept);
        expect(given(PNPM_PROJECT).run("yarn", "global", "add", "x")).toEqual(kept);
    });
});

function project(manager: NodeManager, dependency: string, shebang: string) {
    return nodeProject(
        manager,
        { [dependency]: "^1.0.0" },
        { "/w/bin/cli": `${shebang}\n` },
    );
}

describe("node-manager — scripts", () => {
    test("a declared node-tool shebang runs through the exec runner", () => {
        expect(
            given(project("pnpm", "tsx", "#!/usr/bin/env tsx"))
                .at("/w")
                .run("./bin/cli", "--flag"),
        ).toEqual(rewritten(["pnpm", "exec", "tsx", "./bin/cli", "--flag"]));
        expect(
            given(project("npm", "ts-node", "#!/usr/bin/env ts-node"))
                .at("/w")
                .run("./bin/cli"),
        ).toEqual(rewritten(["npx", "ts-node", "./bin/cli"]));
        expect(
            given(project("yarn", "zx", "#!/usr/bin/env zx"))
                .at("/w")
                .run("./bin/cli"),
        ).toEqual(rewritten(["npx", "zx", "./bin/cli"]));
        expect(
            given(project("bun", "tsx", "#!/usr/bin/env tsx"))
                .at("/w")
                .run("./bin/cli"),
        ).toEqual(rewritten(["bunx", "tsx", "./bin/cli"]));
    });

    test("plain node, undeclared tools and absolute interpreters are kept", () => {
        expect(
            given(project("pnpm", "tsx", "#!/usr/bin/env node"))
                .at("/w")
                .run("./bin/cli"),
        ).toEqual(kept);
        expect(
            given({ ...NPM_PROJECT, "/w/bin/cli": "#!/usr/bin/env tsx\n" })
                .at("/w")
                .run("./bin/cli"),
        ).toEqual(kept);
        expect(
            given(project("pnpm", "tsx", "#!/usr/bin/tsx"))
                .at("/w")
                .run("./bin/cli"),
        ).toEqual(kept);
    });
});
