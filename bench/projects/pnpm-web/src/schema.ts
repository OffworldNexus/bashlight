/** The shape of an item as it crosses the wire. */
export interface Item {
    readonly id: string;
    readonly name: string;
}

/** Returns true when the value looks like an item. */
export function isItem(value: unknown): value is Item {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const candidate = value as { id?: unknown; name?: unknown };
    return typeof candidate.id === "string" && typeof candidate.name === "string";
}
