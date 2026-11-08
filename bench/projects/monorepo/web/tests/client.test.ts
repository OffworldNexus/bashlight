import { describe, expect, it } from "vitest";

import { healthPath } from "../src/client";

describe("healthPath", () => {
    it("builds the health endpoint", () => {
        expect(healthPath()).toBe("/api/health");
    });
});
