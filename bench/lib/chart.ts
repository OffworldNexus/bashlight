/**
 * A tiny, dependency-free chart renderer that emits self-contained SVG.
 *
 * Two chart kinds share the same styling: a grouped bar chart with optional
 * min–max whiskers ({@link renderChart}), and a diverging "delta" chart
 * ({@link renderDeltaChart}) that shows the change with vs without the plugin
 * around a zero line. The charts are meant to be embedded in the docs with
 * `<img>`, so the SVG has a transparent background and every stroke and glyph
 * uses mid-contrast colours that read on both a light and a dark page (a
 * colour based on `currentColor` would not cross the `<img>` boundary). The
 * layout maths — nice axes, tick values, value→pixel scaling and band
 * positions — are pure and unit-tested.
 */

/** Axis and label colour that stays legible on light and dark backgrounds. */
const TEXT_COLOR = "#7f7f7f";
const GRID_COLOR = "#9a9a9a";
/** Whiskers sit over the bar, so they need a colour distinct from it. */
const WHISKER_COLOR = "#6b7280";
/** Semantic colours for the delta chart. */
const BETTER_COLOR = "#16a34a";
const WORSE_COLOR = "#dc2626";
const NEUTRAL_COLOR = "#8b8b8b";
/** A single neutral colour for delta charts that carry no better/worse meaning. */
const NEUTRAL_BAR_COLOR = "#64748b";
const FONT = "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

/** Nice-axis and layout constants for the grouped-bar chart. */
const MARGIN = { left: 76, right: 20, top: 52, bottom: 58 } as const;
const DEFAULT_WIDTH = 760;
const DEFAULT_PANEL_HEIGHT = 300;
const HEADER_HEIGHT = 46;
const TICK_COUNT = 5;
/**
 * Vertical space reserved above the tallest bar (or whisker) so its value
 * label always has room and never lands on the bar or another label.
 */
const LABEL_ROOM = 18;

/** Layout constants for the diverging delta chart. */
const DELTA_MARGIN = { left: 28, right: 24, top: 56, bottom: 40 } as const;
const DELTA_LABEL_WIDTH = 92;
const DELTA_ROW_HEIGHT = 22;
const DELTA_GROUP_HEADING = 24;
const DELTA_GROUP_GAP = 12;
/** Space kept on each side so a bar's value label always fits outside it. */
const DELTA_LABEL_ROOM = 62;
/**
 * The delta axis never spans more than ±200%. A single pathological outlier
 * (a "worse" failed-shell change against a tiny baseline) would otherwise
 * squash every other bar; outliers are clamped to the edge and keep their true
 * label.
 */
const DELTA_AXIS_CAP = 200;

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
    /** A small line under the category label, e.g. `n=5/4`. */
    readonly note?: string;
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
    /** A small line under the title, e.g. the matched-cell summary. */
    readonly subtitle?: string;
    readonly series: readonly ChartSeries[];
    /** One or more panels, stacked vertically and sharing the legend. */
    readonly panels: readonly ChartPanel[];
    readonly width?: number;
    readonly panelHeight?: number;
}

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

/**
 * Maps a signed value onto pixels around a shared zero line, then clamped to
 * `half`. Used by the diverging delta chart, where the sign carries meaning.
 */
export function deltaScale(value: number, maxAbs: number, half: number): number {
    if (!Number.isFinite(value) || maxAbs <= 0) {
        return 0;
    }
    return Math.max(-half, Math.min(half, (value / maxAbs) * half));
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
    return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${size}" font-weight="${weight}" fill="${color}" font-family="${FONT}">${escapeXml(content)}</text>`;
}

/** A vertically rotated label, used for y-axis titles. */
function rotatedText(x: number, y: number, content: string): string {
    return `<text transform="rotate(-90 ${x} ${y})" x="${x}" y="${y}" text-anchor="middle" font-size="11" font-weight="600" fill="${TEXT_COLOR}" font-family="${FONT}">${escapeXml(content)}</text>`;
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

function swatch(x: number, y: number, color: string, label: string): string {
    return (
        `<rect x="${x}" y="${y - 9}" width="12" height="12" rx="2" fill="${color}" />` +
        text(x + 18, y + 1, label, { anchor: "start" })
    );
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
    const top = offsetY + MARGIN.top;
    const baseline = top + plotHeight;
    const max = niceMax(panelMax(panel));
    // Bars stop short of the panel top so every value label sits in the empty
    // band above them, never on a bar, a whisker or another label.
    const scale = (value: number) =>
        scaleValue(value, max, Math.max(1, plotHeight - LABEL_ROOM));
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
    // The y-axis title sits beside the axis, rotated, clear of the tick labels.
    parts.push(rotatedText(16, top + plotHeight / 2, panel.yLabel));
    // Bars, whiskers and value labels.
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
            // Whiskers only exist with at least two samples; they span min→max
            // around the mean with a cap on both ends.
            if (bar.min !== undefined && bar.max !== undefined) {
                const whiskerTop = baseline - scale(bar.max);
                const whiskerBottom = baseline - scale(bar.min);
                const center = barX + inner / 2;
                parts.push(
                    `<line x1="${center.toFixed(2)}" y1="${whiskerTop.toFixed(2)}" x2="${center.toFixed(2)}" y2="${whiskerBottom.toFixed(2)}" stroke="${WHISKER_COLOR}" stroke-width="1.5" />`,
                    `<line x1="${(center - 5).toFixed(2)}" y1="${whiskerTop.toFixed(2)}" x2="${(center + 5).toFixed(2)}" y2="${whiskerTop.toFixed(2)}" stroke="${WHISKER_COLOR}" stroke-width="1.5" />`,
                    `<line x1="${(center - 5).toFixed(2)}" y1="${whiskerBottom.toFixed(2)}" x2="${(center + 5).toFixed(2)}" y2="${whiskerBottom.toFixed(2)}" stroke="${WHISKER_COLOR}" stroke-width="1.5" />`,
                );
            }
            // The value label sits in the reserved band above the bar (or its
            // whisker), in the series colour: legible over the background and
            // never on top of a bar or another label.
            const labelValue = bar.max === undefined ? bar.value : bar.max;
            const labelY = baseline - scale(labelValue) - 5;
            parts.push(
                text(barX + inner / 2, labelY, panel.format(bar.value), {
                    size: 10,
                    color,
                }),
            );
        });
        const labelX =
            MARGIN.left + (layout.groups[categoryIndex] ?? 0) + layout.groupWidth / 2;
        parts.push(text(labelX, baseline + 20, category.label, { size: 12 }));
        if (category.note !== undefined) {
            parts.push(text(labelX, baseline + 33, category.note, { size: 10 }));
        }
    });
    parts.push(`</g>`);
    return parts.join("");
}

/** Renders a complete grouped-bar chart as an SVG document string. */
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
    if (spec.subtitle !== undefined) {
        parts.push(
            text(MARGIN.left - 40, 42, spec.subtitle, { anchor: "start", size: 11 }),
        );
    }
    spec.panels.forEach((panel, index) => {
        parts.push(
            renderPanel(panel, spec, HEADER_HEIGHT + index * panelHeight, width),
        );
    });
    parts.push(`</svg>`);
    return parts.join("");
}

/** One row of the delta chart: a signed change plus how to read it. */
export interface DeltaBar {
    /** The signed change; `NaN` when there is no baseline to compare against. */
    readonly value: number;
    /** The preformatted label, e.g. `−28%`, `+12 pp` or `n/a`. */
    readonly label: string;
    readonly tone: "better" | "worse" | "same";
    readonly available: boolean;
    /** The min–max spread across cells, drawn as a whisker when present. */
    readonly min?: number;
    readonly max?: number;
}

export interface DeltaCategory {
    readonly label: string;
    /** One bar per metric, in the same order as {@link DeltaChartSpec.metrics}. */
    readonly bars: readonly DeltaBar[];
}

/** A shaded band around zero, used to mark the noise level. */
export interface DeltaBand {
    /** The half-width of the band, in the metric's own units. */
    readonly value: number;
    readonly label?: string;
}

export interface DeltaChartSpec {
    readonly title: string;
    /** A small line under the title, e.g. the matched-cell summary. */
    readonly subtitle?: string;
    /** Row labels, e.g. `cost`, `wall time`, `failed shells`, `success`. */
    readonly metrics: readonly string[];
    readonly categories: readonly DeltaCategory[];
    /**
     * Draw every bar in one neutral colour, with no better/worse meaning. Use
     * it when the change is within noise and a green/red reading would
     * overstate it.
     */
    readonly neutral?: boolean;
    readonly band?: DeltaBand;
    readonly width?: number;
    readonly rowHeight?: number;
}

/** The largest absolute value or whisker end, used to scale the zero line. */
function deltaMaxAbs(spec: DeltaChartSpec): number {
    let max = 0;
    for (const category of spec.categories) {
        for (const bar of category.bars) {
            for (const candidate of [bar.value, bar.min, bar.max]) {
                if (candidate !== undefined && Number.isFinite(candidate)) {
                    max = Math.max(max, Math.abs(candidate));
                }
            }
        }
    }
    return Math.min(niceMax(max), DELTA_AXIS_CAP);
}

function deltaColor(bar: DeltaBar, neutral: boolean): string {
    if (neutral) {
        return bar.available ? NEUTRAL_BAR_COLOR : NEUTRAL_COLOR;
    }
    if (!bar.available) {
        return NEUTRAL_COLOR;
    }
    if (bar.tone === "better") {
        return BETTER_COLOR;
    }
    if (bar.tone === "worse") {
        return WORSE_COLOR;
    }
    return NEUTRAL_COLOR;
}

/** Formats a symmetric axis tick, e.g. `−50%`. */
function deltaTickLabel(value: number): string {
    if (value === 0) {
        return "0";
    }
    const sign = value < 0 ? "−" : "+";
    return `${sign}${Math.abs(value).toFixed(0)}%`;
}

/**
 * Renders the diverging delta chart: one bar per metric per category, growing
 * left or right from a shared zero line, coloured green when the change is an
 * improvement and red when it is a regression.
 */
export function renderDeltaChart(spec: DeltaChartSpec): string {
    const width = spec.width ?? DEFAULT_WIDTH;
    const rowHeight = spec.rowHeight ?? DELTA_ROW_HEIGHT;
    const rowCount = spec.categories.length * spec.metrics.length;
    const groupCount = spec.categories.length;
    const plotTop = DELTA_MARGIN.top;
    const plotHeight =
        rowCount * rowHeight + groupCount * (DELTA_GROUP_HEADING + DELTA_GROUP_GAP);
    const baseline = plotTop + plotHeight;
    const height = baseline + DELTA_MARGIN.bottom;
    const x0 = DELTA_MARGIN.left + DELTA_LABEL_WIDTH;
    const x1 = width - DELTA_MARGIN.right;
    const center = (x0 + x1) / 2;
    const half = (x1 - x0) / 2;
    const maxAbs = deltaMaxAbs(spec);
    // Bars stop short of the plot edges so their labels never clip.
    const extent = Math.max(20, half - DELTA_LABEL_ROOM);
    const barHeight = Math.min(14, rowHeight * 0.66);
    const parts: string[] = [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(spec.title)}">`,
        `<title>${escapeXml(spec.title)}</title>`,
        text(DELTA_MARGIN.left, 26, spec.title, {
            anchor: "start",
            size: 16,
            weight: "700",
        }),
        ...(spec.subtitle === undefined
            ? []
            : [
                  text(DELTA_MARGIN.left, 42, spec.subtitle, {
                      anchor: "start",
                      size: 11,
                  }),
              ]),
        ...(spec.neutral === true
            ? [swatch(width - 190, 20, NEUTRAL_BAR_COLOR, "median change")]
            : [
                  swatch(width - 190, 20, BETTER_COLOR, "better"),
                  swatch(width - 108, 20, WORSE_COLOR, "worse"),
              ]),
    ];
    // The noise band sits behind everything, spanning the plot height.
    if (spec.band !== undefined) {
        const bandPx = Math.abs(deltaScale(spec.band.value, maxAbs, extent));
        parts.push(
            `<rect x="${(center - bandPx).toFixed(2)}" y="${plotTop}" width="${(bandPx * 2).toFixed(2)}" height="${plotHeight}" fill="${GRID_COLOR}" fill-opacity="0.14" />`,
        );
        if (spec.band.label !== undefined) {
            parts.push(
                text(center, plotTop + 12, spec.band.label, {
                    size: 10,
                    color: TEXT_COLOR,
                }),
            );
        }
    }
    // Faint grid lines at the half and full ticks.
    for (const tick of [-maxAbs, -maxAbs / 2, maxAbs / 2, maxAbs]) {
        const x = center + deltaScale(tick, maxAbs, extent);
        parts.push(
            `<line x1="${x.toFixed(2)}" y1="${plotTop}" x2="${x.toFixed(2)}" y2="${baseline}" stroke="${GRID_COLOR}" stroke-opacity="0.2" stroke-width="1" />`,
        );
    }
    parts.push(
        `<line x1="${center.toFixed(2)}" y1="${plotTop}" x2="${center.toFixed(2)}" y2="${baseline}" stroke="${GRID_COLOR}" stroke-opacity="0.55" stroke-width="1" />`,
    );
    // Axis ticks along the bottom.
    for (const tick of [-maxAbs, -maxAbs / 2, 0, maxAbs / 2, maxAbs]) {
        const x = center + deltaScale(tick, maxAbs, extent);
        parts.push(
            `<line x1="${x.toFixed(2)}" y1="${baseline}" x2="${x.toFixed(2)}" y2="${baseline + 4}" stroke="${GRID_COLOR}" stroke-opacity="0.6" stroke-width="1" />`,
        );
        parts.push(text(x, baseline + 18, deltaTickLabel(tick), { size: 10 }));
    }
    let cursor = plotTop;
    spec.categories.forEach((category) => {
        parts.push(
            text(DELTA_MARGIN.left, cursor + 15, category.label, {
                anchor: "start",
                size: 13,
                weight: "600",
            }),
        );
        cursor += DELTA_GROUP_HEADING;
        category.bars.forEach((bar, metricIndex) => {
            const rowCenter = cursor + rowHeight / 2;
            const label = spec.metrics[metricIndex] ?? "";
            parts.push(
                text(x0 - 10, rowCenter + 4, label, { anchor: "end", size: 11 }),
            );
            const color = deltaColor(bar, spec.neutral === true);
            if (!bar.available || !Number.isFinite(bar.value)) {
                parts.push(
                    text(center + 6, rowCenter + 4, bar.label, {
                        anchor: "start",
                        size: 10,
                        color,
                    }),
                );
            } else {
                const pixels = deltaScale(bar.value, maxAbs, extent);
                const barX = pixels >= 0 ? center : center + pixels;
                parts.push(
                    `<rect x="${barX.toFixed(2)}" y="${(rowCenter - barHeight / 2).toFixed(2)}" width="${Math.abs(pixels).toFixed(2)}" height="${barHeight.toFixed(2)}" rx="2" fill="${color}" />`,
                );
                // Paired min–max whisker across cells, when there is a spread.
                let edge = pixels;
                if (bar.min !== undefined && bar.max !== undefined) {
                    const minPx = deltaScale(bar.min, maxAbs, extent);
                    const maxPx = deltaScale(bar.max, maxAbs, extent);
                    const left = center + Math.min(minPx, maxPx);
                    const right = center + Math.max(minPx, maxPx);
                    parts.push(
                        `<line x1="${left.toFixed(2)}" y1="${rowCenter.toFixed(2)}" x2="${right.toFixed(2)}" y2="${rowCenter.toFixed(2)}" stroke="${WHISKER_COLOR}" stroke-width="1.5" />`,
                        `<line x1="${left.toFixed(2)}" y1="${(rowCenter - 5).toFixed(2)}" x2="${left.toFixed(2)}" y2="${(rowCenter + 5).toFixed(2)}" stroke="${WHISKER_COLOR}" stroke-width="1.5" />`,
                        `<line x1="${right.toFixed(2)}" y1="${(rowCenter - 5).toFixed(2)}" x2="${right.toFixed(2)}" y2="${(rowCenter + 5).toFixed(2)}" stroke="${WHISKER_COLOR}" stroke-width="1.5" />`,
                    );
                    // The label stays on the bar's own side, just past the
                    // whisker on that side, so it reads next to its bar.
                    edge =
                        pixels >= 0 ? Math.max(minPx, maxPx) : Math.min(minPx, maxPx);
                }
                // The label always sits just outside the bar or whisker; the
                // reserved gutter is wide enough that it never clips.
                const labelX = edge >= 0 ? center + edge + 6 : center + edge - 6;
                parts.push(
                    text(labelX, rowCenter + 4, bar.label, {
                        anchor: edge >= 0 ? "start" : "end",
                        size: 10,
                        color,
                    }),
                );
            }
            cursor += rowHeight;
        });
        cursor += DELTA_GROUP_GAP;
    });
    parts.push(`</svg>`);
    return parts.join("");
}
