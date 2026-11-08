/* eslint-disable sonarjs/function-return-type */
/**
 * Parsing the `--since` window (`10m`, `2h`, `7d`).
 *
 * A bare number means seconds. Unknown units and garbage are reported as
 * `undefined`, so the caller can reject the flag with a usage error.
 */

const UNITS: Readonly<Record<string, number>> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
};

/** Parses `text` to a duration in milliseconds, or `undefined`. */
export function parseDuration(text: string): number | undefined {
    const match = /^(\d+)([smhdw])?$/.exec(text.trim());
    if (match === null) {
        return undefined;
    }
    const amount = Number(match[1] ?? "");
    const factor = UNITS[match[2] ?? "s"];
    if (Number.isNaN(amount) || factor === undefined) {
        return undefined;
    }
    return amount * factor;
}
