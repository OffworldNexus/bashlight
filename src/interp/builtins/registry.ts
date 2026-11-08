/**
 * The builtin registry: one lookup from a builtin name to the strategy that
 * models its effect. A name maps to exactly one `Builtin`.
 */

import type { Builtin } from "./types.ts";

export class BuiltinRegistry {
    private readonly byName: Map<string, Builtin> = new Map();

    constructor(builtins: readonly Builtin[]) {
        for (const builtin of builtins) {
            for (const name of builtin.names) {
                this.byName.set(name, builtin);
            }
        }
    }

    lookup(name: string): Builtin | undefined {
        return this.byName.get(name);
    }
}
