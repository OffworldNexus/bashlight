/**
 * A tiny, dependency-free grouped-bar chart renderer that emits one
 * self-contained SVG.
 *
 * The charts are meant to be embedded in the docs with `<img>`, so the SVG has
 * a transparent background and every stroke and glyph uses mid-contrast
 * colours that read on both a light and a dark page (a text colour based on
 * `currentColor` would not cross the `<img>` boundary). The layout maths —
 * nice axes, tick values, value→pixel scaling and band positions — are pure
 * and unit-tested; only {@link renderChart} turns them into markup.
 */

/** Axis and label colour that stays legible on light and dark backgrounds. */
const TEXT_COLOR = "#7f7f7f";
const GRID_COLOR = "#9a9a9a";

export interface ChartSeries {
    readonly name: string;
    readonly color: string;
}

/** One bar: its value, optionally bracketed by a min–max whisker. */
export interface ChartBar {
    readonly value: number;
    readonly min?: number;
    readonly max?: number;
}

/** A group on the x axis, with one bar per series in order. */
export interface ChartCategory {
    readonly label: string;
    readonly values: readonly ChartBar[];
}

export interface ChartPanel {
    readonly title?: string;
    readonly yLabel: string;
    readonly categories: readonly ChartCategory[];
    readonly format: (value: number) => string;
}

export interface ChartSpec {
    readonly title: string;
    readonly series: readonly ChartSeries[];
    /** One or more panels, stacked vertically and sharing the legend. */
    readonly panels: readonly ChartPanel[];
    readonly width?: number;
    readonly panelHeight?: number;
}

const MARGIN = { left: 64, right: 20, top: 52, bottom: 58 } as const;
const DEFAULT_WIDTH = 760;
const DEFAULT_PANEL_HEIGHT = 300;
const HEADER_HEIGHT = 46;
const TICK_COUNT = 5;

/** Escapes the five XML metacharacters in text and attribute values. */
export function escapeXml(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;");
}

/**
 * Rounds a maximum up to the next "nice" number: 1, 2, 5 or 10 times a power
 * of ten. Returns 1 for a non-positive input so an empty chart still has a
 * valid axis.
 */
export function niceMax(value: number): number {
    if (!Number.isFinite(value) || value <= 0) {
        return 1;
    }
    const exponent = Math.floor(Math.log10(value));
    const magnitude = Math.pow(10, exponent);
    const normalised = value / magnitude;
    let nice: number;
    if (normalised <= 1) {
        nice = 1;
    } else if (normalised <= 2) {
        nice = 2;
    } else if (normalised <= 5) {
        nice = 5;
    } else {
        nice = 10;
    }
    return nice * magnitude;
}

/** Evenly spaced tick values from 0 to `max`, inclusive. */
export function axisTicks(max: number, count = TICK_COUNT): readonly number[] {
    const safeCount = Math.max(1, Math.floor(count));
    const safeMax = max > 0 ? max : 1;
    const ticks: number[] = [];
    for (let index = 0; index <= safeCount; index += 1) {
        ticks.push((safeMax / safeCount) * index);
    }
    return ticks;
}

/** Maps a value onto a pixel length for an axis spanning `[0, max]`. */
export function scaleValue(value: number, max: number, pixels: number): number {
    if (max <= 0) {
        return 0;
    }
    return Math.max(0, Math.min(pixels, (value / max) * pixels));
}

export interface BandLayout {
    readonly categoryWidth: number;
    readonly groupWidth: number;
    readonly barWidth: number;
    /** Left edge of each category's group, in plot coordinates. */
    readonly groups: readonly number[];
}

/**
 * Splits a plot width into evenly sized category bands, each holding a group
 * of `seriesCount` bars with a little air on both sides.
 */
export function bandLayout(
    plotWidth: number,
    categoryCount: number,
    seriesCount: number,
    gapRatio = 0.28,
): BandLayout {
    const categories = Math.max(1, categoryCount);
    const series = Math.max(1, seriesCount);
    const categoryWidth = plotWidth / categories;
    const groupWidth = categoryWidth * (1 - gapRatio);
    const barWidth = groupWidth / series;
    const groups = Array.from(
        { length: categories },
        (_, index) => categoryWidth * index + (categoryWidth - groupWidth) / 2,
    );
    return { categoryWidth, groupWidth, barWidth, groups };
}

function text(
    x: number,
    y: number,
    content: string,
    options: {
        readonly anchor?: string;
        readonly size?: number;
        readonly weight?: string;
        readonly color?: string;
    } = {},
): string {
    const anchor = options.anchor ?? "middle";
    const size = options.size ?? 12;
    const weight = options.weight ?? "normal";
    const color = options.color ?? TEXT_COLOR;
    return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${size}" font-weight="${weight}" fill="${color}" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif">${escapeXml(content)}</text>`;
}

function renderLegend(spec: ChartSpec, x: number, y: number): string {
    const parts: string[] = [];
    let cursor = x;
    for (const series of spec.series) {
        parts.push(
            `<rect x="${cursor}" y="${y - 9}" width="12" height="12" rx="2" fill="${series.color}" />`,
        );
        parts.push(text(cursor + 18, y + 1, series.name, { anchor: "start" }));
        cursor += 18 + series.name.length * 7 + 18;
    }
    return parts.join("");
}

/** The largest value or whisker end across a panel. */
function panelMax(panel: ChartPanel): number {
    let max = 0;
    for (const category of panel.categories) {
        for (const bar of category.values) {
            max = Math.max(max, bar.value, bar.max ?? 0, bar.min ?? 0);
        }
    }
    return max;
}

function renderPanel(
    panel: ChartPanel,
    spec: ChartSpec,
    offsetY: number,
    width: number,
): string {
    const height = spec.panelHeight ?? DEFAULT_PANEL_HEIGHT;
    const plotWidth = width - MARGIN.left - MARGIN.right;
    const plotHeight = height - MARGIN.top - MARGIN.bottom;
    const baseline = offsetY + MARGIN.top + plotHeight;
    const max = niceMax(panelMax(panel));
    const scale = (value: number) => scaleValue(value, max, plotHeight);
    const layout = bandLayout(plotWidth, panel.categories.length, spec.series.length);
    const parts: string[] = [`<g>`];
    if (panel.title !== undefined) {
        parts.push(
            text(MARGIN.left, offsetY + 18, panel.title, {
                anchor: "start",
                size: 14,
                weight: "600",
            }),
        );
    }
    // Horizontal grid lines and y tick labels.
    for (const tick of axisTicks(max)) {
        const y = baseline - scale(tick);
        parts.push(
            `<line x1="${MARGIN.left}" y1="${y}" x2="${MARGIN.left + plotWidth}" y2="${y}" stroke="${GRID_COLOR}" stroke-opacity="0.25" stroke-width="1" />`,
        );
        parts.push(
            text(MARGIN.left - 8, y + 4, panel.format(tick), {
                anchor: "end",
                size: 11,
            }),
        );
    }
    parts.push(
        `<line x1="${MARGIN.left}" y1="${baseline}" x2="${MARGIN.left + plotWidth}" y2="${baseline}" stroke="${GRID_COLOR}" stroke-opacity="0.5" stroke-width="1" />`,
    );
    parts.push(
        text(MARGIN.left - 8, offsetY + MARGIN.top - 10, panel.yLabel, {
            anchor: "end",
            size: 11,
            weight: "600",
        }),
    );
    // Bars.
    panel.categories.forEach((category, categoryIndex) => {
        const groupX = MARGIN.left + (layout.groups[categoryIndex] ?? 0);
        category.values.forEach((bar, seriesIndex) => {
            const series = spec.series[seriesIndex];
            const x = groupX + seriesIndex * layout.barWidth;
            const inner = Math.max(1, layout.barWidth * 0.78);
            const barX = x + (layout.barWidth - inner) / 2;
            const barHeight = scale(bar.value);
            const color = series?.color ?? TEXT_COLOR;
            parts.push(
                `<rect x="${barX.toFixed(2)}" y="${(baseline - barHeight).toFixed(2)}" width="${inner.toFixed(2)}" height="${barHeight.toFixed(2)}" rx="2" fill="${color}" />`,
            );
            if (bar.min !== undefined && bar.max !== undefined) {
                const top = baseline - scale(bar.max);
                const bottom = baseline - scale(bar.min);
                const center = barX + inner / 2;
                parts.push(
                    `<line x1="${center.toFixed(2)}" y1="${top.toFixed(2)}" x2="${center.toFixed(2)}" y2="${bottom.toFixed(2)}" stroke="${color}" stroke-width="1.5" />`,
                    `<line x1="${(center - 5).toFixed(2)}" y1="${top.toFixed(2)}" x2="${(center + 5).toFixed(2)}" y2="${top.toFixed(2)}" stroke="${color}" stroke-width="1.5" />`,
                    `<line x1="${(center - 5).toFixed(2)}" y1="${bottom.toFixed(2)}" x2="${(center + 5).toFixed(2)}" y2="${bottom.toFixed(2)}" stroke="${color}" stroke-width="1.5" />`,
                );
            }
        });
        const labelX =
            MARGIN.left + (layout.groups[categoryIndex] ?? 0) + layout.groupWidth / 2;
        parts.push(text(labelX, baseline + 20, category.label, { size: 12 }));
    });
    parts.push(`</g>`);
    return parts.join("");
}

/** Renders a complete chart as an SVG document string. */
export function renderChart(spec: ChartSpec): string {
    const width = spec.width ?? DEFAULT_WIDTH;
    const panelHeight = spec.panelHeight ?? DEFAULT_PANEL_HEIGHT;
    const height = HEADER_HEIGHT + spec.panels.length * panelHeight + 12;
    const parts: string[] = [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(spec.title)}">`,
        `<title>${escapeXml(spec.title)}</title>`,
        text(MARGIN.left - 40, 26, spec.title, {
            anchor: "start",
            size: 16,
            weight: "700",
        }),
        renderLegend(spec, MARGIN.left + 260, 20),
    ];
    spec.panels.forEach((panel, index) => {
        parts.push(
            renderPanel(panel, spec, HEADER_HEIGHT + index * panelHeight, width),
        );
    });
    parts.push(`</svg>`);
    return parts.join("");
}
