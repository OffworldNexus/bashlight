import { describe, expect, test } from "bun:test";

import { DoctorCommand } from "../../src/cli/commands/doctor.ts";
import type { CommandIo } from "../../src/cli/io.ts";
import {
    auditLine,
    FakeCliFiles,
    FakeRuleAccess,
    outputOf,
    StaticRunner,
    testIo,
} from "./fakes.ts";

const PLUGIN = 'export { default } from "../../src/opencode/plugin.ts";\n';

/** A `CliFiles` layout where the project-local plugin is present. */
function projectLayout(extra: Record<string, string | null> = {}): FakeCliFiles {
    return new FakeCliFiles({
        "/w/.opencode/plugins/bashlight.ts": PLUGIN,
        ...extra,
    });
}

function runner(bun: boolean, opencode: boolean): StaticRunner {
    return new StaticRunner({
        bun: bun ? { status: 0, stdout: "1.3.14\n", stderr: "" } : undefined,
        opencode: opencode
            ? { status: 0, stdout: "opencode v2.2.5\n", stderr: "" }
            : undefined,
    });
}

function doctorIo(overrides: Partial<CommandIo>): CommandIo {
    return testIo({ cwd: "/w", env: { HOME: "/home/u" }, ...overrides });
}

describe("doctor", () => {
    test("passes every check on a healthy layout", async () => {
        const io = doctorIo({
            files: projectLayout({
                "/w/audit.jsonl": auditLine({ time: "2026-11-08T11:00:00.000Z" }),
            }),
            runner: runner(true, true),
        });
        const code = await new DoctorCommand().run(
            ["--project", "/w", "--log", "/w/audit.jsonl"],
            io,
        );
        const text = outputOf(io).text();
        expect(code).toBe(0);
        expect(text).toContain("✓ bun");
        expect(text).toContain("✓ opencode");
        expect(text).toContain("✓ plugin discoverability");
        expect(text).toContain("✓ audit log /w/audit.jsonl");
        expect(text).toContain(
            "✓ self-test: pip install requests → poetry add requests",
        );
        expect(text).not.toContain("⚠ audit log is idle");
    });

    test("fails when no plugin can be found", async () => {
        const io = doctorIo({
            files: new FakeCliFiles({ "/w/audit.jsonl": auditLine() }),
            runner: runner(true, true),
        });
        const code = await new DoctorCommand().run(
            ["--project", "/w", "--log", "/w/audit.jsonl"],
            io,
        );
        const text = outputOf(io).text();
        expect(code).toBe(1);
        expect(text).toContain("✗ plugin discoverability");
        expect(text).toContain('"plugins": ["github:OffworldNexus/bashlight"]');
    });

    test("fails when bun is missing", async () => {
        const io = doctorIo({
            files: projectLayout({ "/w/audit.jsonl": auditLine() }),
            runner: runner(false, true),
        });
        const code = await new DoctorCommand().run(
            ["--project", "/w", "--log", "/w/audit.jsonl"],
            io,
        );
        expect(code).toBe(1);
        expect(outputOf(io).text()).toContain("✗ bun");
    });

    test("warns, but still passes, when opencode is missing", async () => {
        const io = doctorIo({
            files: projectLayout({ "/w/audit.jsonl": auditLine() }),
            runner: runner(true, false),
        });
        const code = await new DoctorCommand().run(
            ["--project", "/w", "--log", "/w/audit.jsonl"],
            io,
        );
        expect(code).toBe(0);
        expect(outputOf(io).text()).toContain("⚠ opencode");
    });

    test("warns when the audit log has seen nothing for a day", async () => {
        const io = doctorIo({
            files: projectLayout({
                "/w/audit.jsonl": auditLine({ time: "2020-01-01T00:00:00.000Z" }),
            }),
            runner: runner(true, true),
        });
        const code = await new DoctorCommand().run(
            ["--project", "/w", "--log", "/w/audit.jsonl"],
            io,
        );
        const text = outputOf(io).text();
        expect(code).toBe(0);
        expect(text).toContain("⚠ audit log is idle");
        expect(text).toContain("failed to load plugin");
    });

    test("fails when the audit log directory is not writable", async () => {
        const io = doctorIo({
            files: new FakeCliFiles(
                {
                    "/w/.opencode/plugins/bashlight.ts": PLUGIN,
                    "/w/audit.jsonl": auditLine(),
                },
                false,
            ),
            runner: runner(true, true),
        });
        const code = await new DoctorCommand().run(
            ["--project", "/w", "--log", "/w/audit.jsonl"],
            io,
        );
        expect(code).toBe(1);
        expect(outputOf(io).text()).toContain("not writable");
    });

    test("finds a globally configured plugin", async () => {
        const io = doctorIo({
            files: new FakeCliFiles({
                "/home/u/.config/opencode/opencode.json": '{"plugins": ["bashlight"]}',
                "/w/audit.jsonl": auditLine(),
            }),
            runner: runner(true, true),
        });
        const code = await new DoctorCommand().run(
            ["--project", "/w", "--log", "/w/audit.jsonl"],
            io,
        );
        const text = outputOf(io).text();
        expect(code).toBe(0);
        expect(text).toContain("config: /home/u/.config/opencode/opencode.json");
    });

    test.each([
        ["github:OffworldNexus/bashlight"],
        ["github:OffworldNexus/bashlight#develop"],
        ["git+https://github.com/OffworldNexus/bashlight.git"],
    ])("recognises the package entry %s", async (spec) => {
        const io = doctorIo({
            files: new FakeCliFiles({
                "/w/opencode.json": `{"plugins": ["${spec}"]}`,
                "/w/audit.jsonl": auditLine(),
            }),
            runner: runner(true, true),
        });
        const code = await new DoctorCommand().run(
            ["--project", "/w", "--log", "/w/audit.jsonl"],
            io,
        );
        expect(code).toBe(0);
        expect(outputOf(io).text()).toContain("config: /w/opencode.json");
    });

    test("recognises the { package, options } form and the plugin key", async () => {
        const io = doctorIo({
            files: new FakeCliFiles({
                "/w/.opencode/opencode.json":
                    '{"plugin": [{"package": "bashlight", "options": {}}]}',
                "/w/audit.jsonl": auditLine(),
            }),
            runner: runner(true, true),
        });
        const code = await new DoctorCommand().run(
            ["--project", "/w", "--log", "/w/audit.jsonl"],
            io,
        );
        expect(code).toBe(0);
        expect(outputOf(io).text()).toContain("config: /w/.opencode/opencode.json");
    });

    test("warns about custom rule files that failed to load", async () => {
        const io = doctorIo({
            files: projectLayout({ "/w/audit.jsonl": auditLine() }),
            runner: runner(true, true),
            ruleAccess: new FakeRuleAccess({
                rules: [],
                errors: [
                    { path: "/w/.opencode/bashlight/rules/bad.ts", message: "boom" },
                ],
            }),
        });
        const code = await new DoctorCommand().run(
            ["--project", "/w", "--log", "/w/audit.jsonl"],
            io,
        );
        const text = outputOf(io).text();
        expect(code).toBe(0);
        expect(text).toContain("⚠ custom rules");
        expect(text).toContain("/w/.opencode/bashlight/rules/bad.ts: boom");
    });
});
