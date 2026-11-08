import { isRecord } from "../shared/guards.ts";

/** A parsed JSON object, still untyped at this point. */
export type JsonObject = Readonly<Record<string, unknown>>;

/** The non-null, non-array object guard, under the name the project used. */
export { isRecord as isObject };

/**
 * Parses a JSON document into an object, returning `undefined` for anything
 * that is missing, malformed, or not an object. Never throws.
 */
export function parseJsonObject(text: string | undefined): JsonObject | undefined {
    let parsed: unknown;
    try {
        parsed = text === undefined ? undefined : (JSON.parse(text) as unknown);
    } catch {
        parsed = undefined;
    }
    return isRecord(parsed) ? parsed : undefined;
}
