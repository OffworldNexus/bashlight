/**
 * Shared runtime type guards.
 *
 * `shared` is the leaf module: this file imports nothing, so every layer may
 * depend on it. Guards are the boundary where `unknown` data (hook events,
 * parsed JSON) becomes usable, so the rest of the code base never casts.
 */

/** True for a non-null, non-array object. */
export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Element-wise equality of two arrays; `undefined` values compare equal. */
export function sameValues<T>(
    left: readonly (T | undefined)[],
    right: readonly (T | undefined)[],
): boolean {
    return left.length === right.length && left.every((value, i) => value === right[i]);
}
