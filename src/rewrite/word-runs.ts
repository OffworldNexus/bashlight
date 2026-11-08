/** Groups the arguments of one word expansion into their source-word runs. */

import type { Arg } from "../interp/values.ts";
import type { Word } from "../syntax/index.ts";

export interface WordRun {
    readonly word: Word;
    readonly args: readonly Arg[];
    /** Index of the first argument of the run. */
    readonly start: number;
    /** Index one past the last argument of the run. */
    readonly end: number;
}

/** The maximal runs of consecutive arguments that share one source word. */
export function wordRuns(args: readonly Arg[]): WordRun[] {
    const runs: WordRun[] = [];
    let index = 0;
    while (index < args.length) {
        const arg = args[index];
        if (arg === undefined) {
            index += 1;
            continue;
        }
        let end = index;
        while (end < args.length && args[end]?.word === arg.word) {
            end += 1;
        }
        runs.push({ word: arg.word, args: args.slice(index, end), start: index, end });
        index = end;
    }
    return runs;
}
