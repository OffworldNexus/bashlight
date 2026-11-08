/**
 * The ordered list of wrapper strategies. Order matters only when two wrappers
 * could match the same command word; the first one that returns a result wins.
 */

import type { Wrapper } from "./types.ts";

export class WrapperRegistry {
    constructor(private readonly wrappers: readonly Wrapper[]) {}

    all(): readonly Wrapper[] {
        return this.wrappers;
    }
}
