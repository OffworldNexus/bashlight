import { describe, expect, it } from "vitest";

import { toIso } from "../src/time";

describe("toIso", () => {
    it("formats a date as an ISO string in UTC", () => {
        expect(toIso(new Date("2020-01-02T03:04:05.000Z"))).toBe(
            "2020-01-02T03:04:05.000Z",
        );
    });
});
