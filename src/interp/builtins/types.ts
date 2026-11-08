/**
 * The builtin extension point. A `Builtin` recognizes one or more shell builtin
 * names and applies their static effect (moving the cwd, setting variables,
 * recording a sourced file…) against a narrow `VariableStore`, never the whole
 * interpreter session.
 */

import type { ScriptDocument } from "../documents.ts";
import type { Scope } from "../environment.ts";
import type { VariableStore } from "../interfaces.ts";
import type { Arg } from "../values.ts";

export interface BuiltinInput {
    /** The builtin's name (the effective `argv[0]`). */
    readonly name: string;
    /** The effective argv (after wrapper peeling). */
    readonly argv: readonly Arg[];
    readonly doc: ScriptDocument;
    readonly scope: Scope;
    readonly store: VariableStore;
}

export interface Builtin {
    readonly names: readonly string[];
    apply(input: BuiltinInput): void;
}
