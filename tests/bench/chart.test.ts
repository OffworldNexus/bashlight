import { describe, expect, test } from "bun:test";

import {
    axisTicks,
    bandLayout,
    escapeXml,
    niceMax,
    renderChart,
    scaleValue,
} from "../../bench/lib/chart.ts";

describe("niceMax", () => {
    test("rounds up to 1, 2 or 5 times a power of ten", () => {
        expect(niceMax(0.7)).toBe(1);
        expect(niceMax(1.4)).toBe(2);
        expect(niceMax(3)).toBe(5);
        expect(niceMax(6)).toBe(10);
        expect(niceMax(11)).toBe(20);
        expect(niceMax(0.03)).toBeCloseTo(0.05, 10);
    });

    test("returns 1 for a non-positive or invalid value", () => {
        expect(niceMax(0)).toBe(1);
        expect(niceMax(-3)).toBe(1);
        expect(niceMax(Number.NaN)).toBe(1);
    });
});

describe("axisTicks", () => {
    test("spaces ticks evenly from zero to the maximum", () => {
        expect(axisTicks(10, 2)).toEqual([0, 5, 10]);
        expect(axisTicks(1, 4)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    });

    test("falls back to a unit axis for a zero maximum", () => {
        expect(axisTicks(0, 2)).toEqual([0, 0.5, 1]);
    });
});

describe("scaleValue", () => {
    test("maps a value proportionally and clamps to the plot", () => {
        expect(scaleValue(5, 10, 100)).toBe(50);
        expect(scaleValue(15, 10, 100)).toBe(100);
        expect(scaleValue(-5, 10, 100)).toBe(0);
    });

    test("returns zero when the maximum is not positive", () => {
        expect(scaleValue(5, 0, 100)).toBe(0);
    });
});

describe("bandLayout", () => {
    test("splits the width into equal category bands with grouped bars", () => {
        const layout = bandLayout(400, 2, 2, 0.5);
        expect(layout.categoryWidth).toBe(200);
        expect(layout.groupWidth).toBe(100);
        expect(layout.barWidth).toBe(50);
        // Each group is centred inside its category band.
        expect(layout.groups).toEqual([50, 250]);
    });

    test("never divides by zero", () => {
        const layout = bandLayout(100, 0, 0);
        expect(layout.categoryWidth).toBe(100);
        expect(layout.barWidth).toBeGreaterThan(0);
    });
});

describe("escapeXml", () => {
    test("escapes the five metacharacters", () => {
        expect(escapeXml(`<a & "b" 'c'>`)).toBe(
            "&lt;a &amp; &quot;b&quot; &apos;c&apos;&gt;",
        );
    });
});

describe("renderChart", () => {
    const spec = {
        title: "Success by model",
        series: [
            { name: "without", color: "#f59e0b" },
            { name: "with", color: "#3b82f6" },
        ],
        panels: [
            {
                yLabel: "Success",
                format: (value: number) => `${value.toFixed(0)}%`,
                categories: [
                    {
                        label: "m1",
                        values: [
                            { value: 50, min: 0, max: 100 },
                            { value: 100, min: 100, max: 100 },
                        ],
                    },
                ],
            },
        ],
    };

    test("renders an svg with bars, labels and a legend", () => {
        const svg = renderChart(spec);
        expect(svg.startsWith("<svg")).toBe(true);
        expect(svg).toContain("</svg>");
        expect(svg).toContain("Success by model");
        expect(svg).toContain("without");
        expect(svg).toContain("with");
        expect(svg).toContain(">m1<");
        expect(svg).toContain("<rect");
        expect(svg).toContain("100%");
    });

    test("draws min–max whiskers when a bar carries them", () => {
        const svg = renderChart(spec);
        expect(svg).toContain('stroke-width="1.5"');
    });
});
