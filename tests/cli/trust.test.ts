import { describe, expect, test } from "bun:test";

import { TrustCommand } from "../../src/cli/commands/trust.ts";
import { UntrustCommand } from "../../src/cli/commands/untrust.ts";
import type { MutableTrustStore } from "../../src/rules/custom/index.ts";
import { FakeCliFiles, FakeTrust, outputOf, testIo } from "./fakes.ts";

describe("trust / untrust", () => {
    test("trust records the directory and lists the files it enables", async () => {
        const files = new FakeCliFiles({
            "/w/.opencode/bashlight/rules/make-test.ts": "export default {};\n",
            "/w/.opencode/bashlight/rules/notes.md": "ignored\n",
        });
        const trust = new FakeTrust();
        const io = testIo({ files, cwd: "/elsewhere", trust });
        const code = await new TrustCommand().run(["/w"], io);
        const text = outputOf(io).text();
        expect(code).toBe(0);
        expect(trust.isTrusted("/w")).toBe(true);
        expect(text).toContain("trusted /w");
        expect(text).toContain("enables /w/.opencode/bashlight/rules/make-test.ts");
        expect(text).not.toContain("notes.md");
    });

    test("trust defaults to the current directory", async () => {
        const files = new FakeCliFiles({});
        const trust = new FakeTrust();
        const io = testIo({ files, cwd: "/w", trust });
        await new TrustCommand().run([], io);
        expect(trust.isTrusted("/w")).toBe(true);
    });

    test("trust reports a write failure", async () => {
        const trust: MutableTrustStore = {
            isTrusted: () => false,
            list: () => [],
            trust: () => {
                throw new Error("read-only");
            },
            untrust: () => {},
        };
        const io = testIo({ trust });
        const code = await new TrustCommand().run(["/w"], io);
        expect(code).toBe(1);
        expect(outputOf(io).text()).toContain("could not write the trust file");
    });

    test("untrust removes the directory", async () => {
        const trust = new FakeTrust(["/w"]);
        const io = testIo({ cwd: "/w", trust });
        const code = await new UntrustCommand().run([], io);
        expect(code).toBe(0);
        expect(trust.isTrusted("/w")).toBe(false);
        expect(outputOf(io).text()).toContain("untrusted /w");
    });
});
