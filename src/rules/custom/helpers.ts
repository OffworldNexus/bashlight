/**
 * The toolbox a custom rule factory receives.
 *
 * It bundles the verdict builders and the command-line knowledge parsers, so a
 * rule file needs no runtime import of bashlight: the loader hands it
 * everything it can use. Types can still be imported type-only
 * (`import type { RuleFactory } from "bashlight"`), which is erased at runtime.
 */

import { parseNodeCommand } from "../knowledge/node-command-line.ts";
import { isVenvActive, parsePythonCommand } from "../knowledge/python-command-line.ts";
import { arg, argsFrom, block, indexRange, keep, replace, text } from "../verdict.ts";

export interface RuleHelpers {
    // Verdict builders.
    readonly keep: typeof keep;
    readonly block: typeof block;
    readonly replace: typeof replace;
    readonly arg: typeof arg;
    readonly argsFrom: typeof argsFrom;
    readonly text: typeof text;
    readonly indexRange: typeof indexRange;
    // Command-line knowledge.
    readonly parsePythonCommand: typeof parsePythonCommand;
    readonly parseNodeCommand: typeof parseNodeCommand;
    readonly isVenvActive: typeof isVenvActive;
}

/** The production helpers; the same object is passed to every factory. */
export function createRuleHelpers(): RuleHelpers {
    return {
        keep,
        block,
        replace,
        arg,
        argsFrom,
        text,
        indexRange,
        parsePythonCommand,
        parseNodeCommand,
        isVenvActive,
    };
}
