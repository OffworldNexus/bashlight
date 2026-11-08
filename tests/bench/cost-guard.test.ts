import { describe, expect, test } from "bun:test";

import { CostGuard } from "../../bench/lib/cost-guard.ts";

describe("CostGuard", () => {
    test("always allows the first run and projects nothing", () => {
        const guard = new CostGuard(0.01);
        const check = guard.check();
        expect(check.stop).toBe(false);
        expect(check.mean).toBe(0);
        expect(check.projection).toBe(0);
    });

    test("stops when spend plus the mean would cross the cap", () => {
        const guard = new CostGuard(0.05);
        guard.record(0.04);
        // spent 0.04 + mean 0.04 = 0.08 > 0.05
        const check = guard.check();
        expect(check.stop).toBe(true);
        expect(check.mean).toBeCloseTo(0.04, 10);
        expect(check.projection).toBeCloseTo(0.08, 10);
    });

    test("keeps going while the projection stays under the cap", () => {
        const guard = new CostGuard(1);
        guard.record(0.01);
        guard.record(0.02);
        const check = guard.check();
        expect(check.stop).toBe(false);
        expect(check.spent).toBeCloseTo(0.03, 10);
        expect(check.mean).toBeCloseTo(0.015, 10);
        expect(check.projection).toBeCloseTo(0.045, 10);
    });
});
