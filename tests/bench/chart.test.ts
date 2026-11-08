import { describe, expect, test } from "bun:test";

import {
    axisTicks,
    bandLayout,
    deltaScale,
    escapeXml,
    niceMax,
    renderChart,
    renderDeltaChart,
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

describe("deltaScale", () => {
    test("keeps the sign around a shared zero and clamps to the half width", () => {
        expect(deltaScale(50, 100, 200)).toBe(100);
        expect(deltaScale(-50, 100, 200)).toBe(-100);
        expect(deltaScale(150, 100, 200)).toBe(200);
        expect(deltaScale(-150, 100, 200)).toBe(-200);
    });

    test("returns zero for an invalid value or a zero maximum", () => {
        expect(deltaScale(Number.NaN, 100, 200)).toBe(0);
        expect(deltaScale(50, 0, 200)).toBe(0);
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
                            { value: 33, min: 0, max: 100 },
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

    test("labels every bar with its formatted value", () => {
        const svg = renderChart(spec);
        // The 33% bar carries its own value label, distinct from the tick.
        expect(svg).toContain(">33%</text>");
    });

    test("puts the y-axis title beside the axis, rotated", () => {
        const svg = renderChart(spec);
        expect(svg).toContain('transform="rotate(-90');
        expect(svg).toContain(">Success</text>");
    });

    test("draws min–max whiskers when a bar carries them", () => {
        const svg = renderChart(spec);
        expect(svg).toContain('stroke-width="1.5"');
    });

    test("omits whiskers for a bar without a spread", () => {
        const withoutWhiskers = {
            ...spec,
            panels: [
                {
                    yLabel: "Success",
                    format: (value: number) => `${value.toFixed(0)}%`,
                    categories: [{ label: "m1", values: [{ value: 33 }] }],
                },
            ],
        };
        expect(renderChart(withoutWhiskers)).not.toContain('stroke-width="1.5"');
    });

    test("renders a category note under the label", () => {
        const withNote = {
            ...spec,
            panels: [
                {
                    yLabel: "Success",
                    format: (value: number) => `${value.toFixed(0)}%`,
                    categories: [
                        {
                            label: "m1",
                            note: "n=5/4",
                            values: [{ value: 33 }, { value: 100 }],
                        },
                    ],
                },
            ],
        };
        expect(renderChart(withNote)).toContain(">n=5/4</text>");
    });

    test("never draws a value label in white", () => {
        expect(renderChart(spec)).not.toContain("#ffffff");
    });
});

describe("renderDeltaChart", () => {
    const spec = {
        title: "Change with bashlight",
        metrics: ["cost", "success"],
        categories: [
            {
                label: "m1",
                bars: [
                    {
                        value: -28,
                        label: "−28%",
                        tone: "better" as const,
                        available: true,
                    },
                    {
                        value: 12,
                        label: "+12 pp",
                        tone: "better" as const,
                        available: true,
                    },
                ],
            },
            {
                label: "m2",
                bars: [
                    {
                        value: 40,
                        label: "+40%",
                        tone: "worse" as const,
                        available: true,
                    },
                    {
                        value: Number.NaN,
                        label: "n/a",
                        tone: "same" as const,
                        available: false,
                    },
                ],
            },
        ],
    };

    test("renders bars around a zero line with better/worse colours", () => {
        const svg = renderDeltaChart(spec);
        expect(svg).toContain("Change with bashlight");
        expect(svg).toContain(">cost<");
        expect(svg).toContain(">success<");
        expect(svg).toContain("−28%");
        expect(svg).toContain("+12 pp");
        expect(svg).toContain("#16a34a");
        expect(svg).toContain("#dc2626");
        expect(svg).toContain("better");
        expect(svg).toContain("worse");
    });

    test("shows n/a without a bar when the baseline is zero", () => {
        const svg = renderDeltaChart(spec);
        expect(svg).toContain("n/a");
        expect(svg).toContain(">n/a</text>");
    });

    test("neutral mode uses one colour and draws a labelled noise band", () => {
        const svg = renderDeltaChart({
            title: "No measurable overhead",
            metrics: ["cost / run", "wall time"],
            neutral: true,
            band: { value: 10, label: "noise ±10%" },
            categories: [
                {
                    label: "m1",
                    bars: [
                        {
                            value: -4,
                            label: "−4%",
                            tone: "better" as const,
                            available: true,
                            min: -22,
                            max: 1,
                        },
                        {
                            value: 0,
                            label: "0%",
                            tone: "same" as const,
                            available: true,
                            min: -11,
                            max: 2,
                        },
                    ],
                },
            ],
        });
        expect(svg).toContain("#64748b");
        expect(svg).not.toContain("#16a34a");
        expect(svg).not.toContain("#dc2626");
        expect(svg).toContain("noise ±10%");
        expect(svg).toContain("median change");
        expect(svg).toContain("−4%");
    });
});
