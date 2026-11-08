/**
 * The headline numbers behind the two messages the benchmark page carries.
 *
 * The page must either confirm or reject two claims: flash-class models get
 * cheaper and faster runs, and smaller models complete more often. Both are
 * computed from **matched cells** (see `lib/report.ts`) as a **paired median
 * change** with a min–max spread across cells, so a single project cannot swing
 * the result.
 *
 * This object feeds both the headline SVGs and `bench/HEADLINES.json`, so the
 * charts and the prose can never disagree.
 */

import { displayName, orderBySize, type Tier, tierOf } from "./models.ts";
import {
    cellId,
    type CellIndex,
    cellMeans,
    costMetric,
    mean,
    type PairedChange,
    pairedChange,
    successMetric,
    wallMetric,
} from "./report.ts";

/** Everything the report needs about one model. */
export interface ModelHeadline {
    readonly model: string;
    readonly display: string;
    readonly tier: Tier;
    /** Matched cells (projects) that contributed. */
    readonly cells: number;
    readonly runsWithout: number;
    readonly runsWith: number;
    /** Paired median change in cost per run, with min–max across cells. */
    readonly cost: PairedChange;
    /** Paired median change in wall time, with min–max across cells. */
    readonly time: PairedChange;
    /** Completion rate in `without` mode, 0..1. */
    readonly successWithout: number;
    /** Completion rate in `with` mode, 0..1. */
    readonly successWith: number;
}

function runCount(
    index: CellIndex,
    select: (cell: { readonly project: string; readonly model: string }) => boolean,
    mode: "with" | "without",
): number {
    const map = mode === "with" ? index.withRuns : index.withoutRuns;
    return index.matched
        .filter(select)
        .reduce((sum, cell) => sum + (map.get(cellId(cell))?.length ?? 0), 0);
}

/** The headline figures for one model, over its matched cells only. */
export function modelHeadline(index: CellIndex, model: string): ModelHeadline {
    const select = (cell: { readonly project: string; readonly model: string }) =>
        cell.model === model;
    return {
        model,
        display: displayName(model),
        tier: tierOf(model),
        cells: index.matched.filter(select).length,
        runsWithout: runCount(index, select, "without"),
        runsWith: runCount(index, select, "with"),
        cost: pairedChange(index, select, costMetric, "lower", "percent"),
        time: pairedChange(index, select, wallMetric, "lower", "percent"),
        successWithout: mean(cellMeans(index, select, "without", successMetric)),
        successWith: mean(cellMeans(index, select, "with", successMetric)),
    };
}

/** The two headline messages, computed from the matched cells. */
export interface Headlines {
    readonly matchedCells: number;
    readonly runs: number;
    /** Message 1: cost and time change, flash-class models only. */
    readonly costTime: readonly ModelHeadline[];
    /** Message 2: completion with vs without, every model, smallest first. */
    readonly completion: readonly ModelHeadline[];
}

/** Builds both headline message sets from a matched-cell index. */
export function buildHeadlines(index: CellIndex): Headlines {
    const models = [...new Set(index.matched.map((cell) => cell.model))];
    const bySize = orderBySize(models);
    const ordered = models
        .map((model) => modelHeadline(index, model))
        .sort(
            (left, right) => bySize.indexOf(left.model) - bySize.indexOf(right.model),
        );
    return {
        matchedCells: index.matched.length,
        runs: index.matchedRuns.length,
        costTime: ordered.filter((entry) => entry.tier === "flash"),
        completion: ordered,
    };
}

/** The JSON document written to `bench/HEADLINES.json`. */
export function headlinesDocument(headlines: Headlines): Record<string, unknown> {
    return {
        matchedCells: headlines.matchedCells,
        runs: headlines.runs,
        costTime: {
            tier: "flash",
            models: headlines.costTime,
        },
        completion: {
            models: headlines.completion,
        },
    };
}
