/**
 * The rewrite strategies, tried in order from most surgical to least. Each is a
 * small object over a `CommandPlanner`; a strategy returns `undefined` when it
 * does not apply and an error when it applies but cannot express the change.
 */

import type { Replacement } from "../rules/rule.ts";
import type { Alignment } from "./alignment.ts";
import type { CommandPlanner, PlanOutcome } from "./command-planner.ts";

export interface StrategyInput {
    readonly planner: CommandPlanner;
    /** `undefined` when the replacement arguments are reordered. */
    readonly alignment: Alignment | undefined;
    readonly replacements: readonly Replacement[];
    /** Gaps another strategy already consumed (binding absorption). */
    readonly gaps: ReadonlySet<number>;
    /** Words another strategy already consumed. */
    readonly words: ReadonlySet<unknown>;
}

/** `undefined` = not applicable; a result = applicable (ok or error). */
export type StrategyResult = PlanOutcome | undefined;

export interface RewriteStrategy {
    plan(input: StrategyInput): StrategyResult;
}

/** Strategy 1: whole-word insertions, deletions and kept arguments. */
export class WordLevelStrategy implements RewriteStrategy {
    plan(input: StrategyInput): StrategyResult {
        const { planner, alignment, gaps } = input;
        return alignment === undefined ? undefined : planner.wordLevel(alignment, gaps);
    }
}

/** Strategy 3: replaces a word as a whole by the quoted values covering it. */
export class InlineStrategy implements RewriteStrategy {
    plan(input: StrategyInput): StrategyResult {
        const { planner, alignment, replacements, words } = input;
        return alignment === undefined
            ? undefined
            : planner.inline(replacements, alignment, words);
    }
}

/** Strategy 4: regenerates the whole effective command range. */
export class RegenerateStrategy implements RewriteStrategy {
    plan(input: StrategyInput): StrategyResult {
        return input.planner.regenerate(input.replacements);
    }
}

/** The default order: word level, inline, regenerate. */
export function createStrategies(): readonly RewriteStrategy[] {
    return [new WordLevelStrategy(), new InlineStrategy(), new RegenerateStrategy()];
}
