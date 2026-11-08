/* eslint-disable sonarjs/cognitive-complexity, sonarjs/function-return-type */
/**
 * A conservative, reusable option scanner. It understands short flags, short
 * options with attached or separate values, long flags, and long options with
 * `=value`. By default anything it does not recognize fails the scan
 * (`undefined`) so a wrapper does not unwrap a command it does not understand;
 * with `unknownStops` an unknown option simply ends the option region (used by
 * builtins whose names follow the options).
 */

import type { Arg } from "../values.ts";
import { isOption } from "./options.ts";

export interface OptionSpec {
    readonly shortFlags: ReadonlySet<string>;
    readonly shortValues: ReadonlySet<string>;
    readonly longFlags: ReadonlySet<string>;
    readonly longValues: ReadonlySet<string>;
    /** An unknown option ends the option region instead of failing. */
    readonly unknownStops?: boolean;
}

export function splitLong(value: string): [string, string | undefined] {
    const eq = value.indexOf("=");
    return eq === -1 ? [value, undefined] : [value.slice(0, eq), value.slice(eq + 1)];
}

/** The index of the first non-option word, or `undefined` when unrecognized. */
export function scanOptions(
    argv: readonly Arg[],
    start: number,
    spec: OptionSpec,
): number | undefined {
    let index = start;
    while (index < argv.length) {
        const value = argv[index]?.value;
        if (value === undefined) {
            return spec.unknownStops === true ? index : undefined;
        }
        if (value === "--") {
            return index + 1;
        }
        if (!isOption(value)) {
            return index;
        }
        const stop = spec.unknownStops === true ? index : undefined;
        if (value.startsWith("--")) {
            const [flag, inline] = splitLong(value);
            if (spec.longFlags.has(flag)) {
                index += 1;
                continue;
            }
            if (spec.longValues.has(flag)) {
                index += inline === undefined ? 2 : 1;
                if (index > argv.length) {
                    return undefined;
                }
                continue;
            }
            return stop;
        }
        let consumedValue = false;
        let known = true;
        for (let c = 1; c < value.length; c += 1) {
            const ch = value[c] as string;
            if (spec.shortFlags.has(ch)) {
                continue;
            }
            if (spec.shortValues.has(ch)) {
                consumedValue = value.slice(c + 1) === "";
                break;
            }
            known = false;
            break;
        }
        if (!known) {
            return stop;
        }
        index += consumedValue ? 2 : 1;
        if (index > argv.length) {
            return undefined;
        }
    }
    return index;
}
