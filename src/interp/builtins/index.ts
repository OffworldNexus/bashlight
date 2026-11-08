/** Wires the default builtin strategies. */

import { AssignmentBuiltin } from "./assignments.ts";
import { CdBuiltin, PopdBuiltin, PushdBuiltin } from "./cd.ts";
import { PassthroughBuiltin, SetBuiltin, ShiftBuiltin, UnsetBuiltin } from "./core.ts";
import { GetoptsBuiltin, MapfileBuiltin, PrintfBuiltin, ReadBuiltin } from "./read.ts";
import { CondaBuiltin, DeactivateBuiltin, SourceBuiltin } from "./source.ts";
import type { Builtin } from "./types.ts";

export function createBuiltins(): readonly Builtin[] {
    return [
        new CdBuiltin(),
        new PushdBuiltin(),
        new PopdBuiltin(),
        new AssignmentBuiltin(),
        new UnsetBuiltin(),
        new SetBuiltin(),
        new ShiftBuiltin(),
        new SourceBuiltin(),
        new DeactivateBuiltin(),
        new CondaBuiltin(),
        new ReadBuiltin(),
        new MapfileBuiltin(),
        new GetoptsBuiltin(),
        new PrintfBuiltin(),
        new PassthroughBuiltin(),
    ];
}
