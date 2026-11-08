import { describe, expect, test } from "bun:test";

import { pnpmProject, rewritten } from "./fixtures.ts";

describe("pnpm project", () => {
    const AT = { cwd: "/w", files: pnpmProject("/w") };

    test("translates npm install to pnpm add", () => {
        expect(rewritten("npm install -D vitest", AT)).toBe("pnpm add -D vitest");
    });

    test("translates npx to pnpm exec for a declared tool", () => {
        expect(rewritten("npx vitest run", AT)).toBe("pnpm exec vitest run");
    });
});
