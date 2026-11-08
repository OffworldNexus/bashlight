/**
 * Builtins whose target variable becomes unknown: `read`, `mapfile`,
 * `readarray`, `getopts`, and `printf -v`.
 */

import type { Arg } from "../values.ts";
import { type OptionSpec, scanOptions } from "../wrappers/scan.ts";
import type { Builtin, BuiltinInput } from "./types.ts";

const READ_OPTIONS: OptionSpec = {
    shortFlags: new Set(["r", "s", "e"]),
    shortValues: new Set(["p", "u", "n", "N", "t", "d", "a", "i"]),
    longFlags: new Set(),
    longValues: new Set(),
    unknownStops: true,
};

const MAPFILE_OPTIONS: OptionSpec = {
    shortFlags: new Set(["t"]),
    shortValues: new Set(["n", "O", "s", "u", "C", "c", "d"]),
    longFlags: new Set(),
    longValues: new Set(),
    unknownStops: true,
};

/** The words after the option region (an unknown option ends it). */
function namesAfterOptions(argv: readonly Arg[], options: OptionSpec): readonly Arg[] {
    const index = scanOptions(argv, 1, options);
    return index === undefined ? [] : argv.slice(index);
}

export class ReadBuiltin implements Builtin {
    readonly names = ["read"] as const;

    apply(input: BuiltinInput): void {
        const names = namesAfterOptions(input.argv, READ_OPTIONS);
        if (names.length === 0) {
            input.store.setUnknown(input.scope, "REPLY");
            return;
        }
        for (const arg of names) {
            const name = arg.value;
            if (name !== undefined && /^[A-Za-z_]\w*$/.test(name)) {
                input.store.setUnknown(input.scope, name);
            }
        }
    }
}

export class MapfileBuiltin implements Builtin {
    readonly names = ["mapfile", "readarray"] as const;

    apply(input: BuiltinInput): void {
        const names = namesAfterOptions(input.argv, MAPFILE_OPTIONS);
        const array = names[0]?.value ?? "MAPFILE";
        input.store.setUnknown(input.scope, array);
    }
}

export class GetoptsBuiltin implements Builtin {
    readonly names = ["getopts"] as const;

    apply(input: BuiltinInput): void {
        const name = input.argv[2]?.value;
        if (name !== undefined && /^[A-Za-z_]\w*$/.test(name)) {
            input.store.setUnknown(input.scope, name);
        }
    }
}

export class PrintfBuiltin implements Builtin {
    readonly names = ["printf"] as const;

    apply(input: BuiltinInput): void {
        if (input.argv[1]?.value !== "-v") {
            return;
        }
        const name = input.argv[2]?.value;
        if (name !== undefined && /^[A-Za-z_]\w*$/.test(name)) {
            input.store.setUnknown(input.scope, name);
        }
    }
}
