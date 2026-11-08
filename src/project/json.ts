/** A parsed JSON object, still untyped at this point. */
export type JsonObject = Readonly<Record<string, unknown>>;

/** True for a non-null, non-array object. */
export function isObject(value: unknown): value is JsonObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
    return isObject(parsed) ? parsed : undefined;
}
