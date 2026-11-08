import { describe, expect, it } from "vitest";

import { isItem } from "../src/schema";

describe("isItem", () => {
    it("accepts a well-formed item", () => {
        expect(isItem({ id: "1", name: "Widget" })).toBe(true);
    });

    it("rejects values missing fields", () => {
        expect(isItem({ id: "1" })).toBe(false);
        expect(isItem(null)).toBe(false);
    });
});
