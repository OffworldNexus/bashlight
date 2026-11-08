/**
 * Small bounded collections, so long-lived caches cannot grow without limit.
 *
 * Pure data structures: no timers, no I/O, no dependencies. They are the only
 * place the "keep at most N entries, evict the least recently used" policy is
 * expressed.
 */

/** A `Map` with a maximum size; the least-recently-used key is evicted first. */
export class LruMap<K, V> {
    private readonly entries = new Map<K, V>();

    constructor(private readonly maxEntries: number) {}

    get(key: K): V | undefined {
        const value = this.entries.get(key);
        if (value !== undefined) {
            // Re-insert so the entry moves to the most-recently-used end.
            this.entries.delete(key);
            this.entries.set(key, value);
        }
        return value;
    }

    set(key: K, value: V): void {
        this.entries.delete(key);
        this.entries.set(key, value);
        if (this.entries.size > this.maxEntries) {
            const oldest = this.entries.keys().next().value;
            if (oldest !== undefined) {
                this.entries.delete(oldest);
            }
        }
    }

    get size(): number {
        return this.entries.size;
    }
}

/** A `Set` with a maximum size; the oldest insertion is evicted first. */
export class BoundedSet<T> {
    private readonly values = new Set<T>();

    constructor(private readonly maxEntries: number) {}

    has(value: T): boolean {
        return this.values.has(value);
    }

    add(value: T): void {
        this.values.delete(value);
        this.values.add(value);
        if (this.values.size > this.maxEntries) {
            const oldest = this.values.values().next().value;
            if (oldest !== undefined) {
                this.values.delete(oldest);
            }
        }
    }
}
