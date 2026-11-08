/**
 * A `Binding` is the identity of a variable's value at a point in the script.
 * The rewriter uses it to fold a change to a `$VAR` expansion back into the
 * assignment that produced it, so a binding is deliberately shared by every
 * use of the same assignment.
 */

import type {
    Assignment,
    AssignmentWord,
    ParameterExpansionPart,
    SourceDocument,
    Word,
} from "../syntax/index.ts";
import type { ScriptDocument } from "./documents.ts";
import type { Invocation } from "./invocation.ts";
import type { Fragment } from "./values.ts";

/** An `export A=1`-style argument: a word that carries an assignment. */
export interface BindingFromWord {
    readonly kind: "word";
    readonly word: Word;
    readonly parsed: AssignmentWord;
}

export type BindingAssignment = Assignment | BindingFromWord;

/** A synthetic assignment source (a loop variable, a `printf -v` target…). */
export interface SyntheticBinding {
    readonly kind: "synthetic";
}

/** Where a binding comes from: a real assignment, or a synthetic one. */
export type BindingSource = BindingAssignment | SyntheticBinding;

export interface Binding {
    readonly name: string;
    /** The expanded value at assignment time. Empty for the initial env. */
    readonly value: readonly Fragment[];
    /** The assignment this binding comes from; `undefined` for the initial env. */
    readonly assignment: BindingSource | undefined;
    readonly doc: ScriptDocument | undefined;
    readonly exported: boolean;
}

/** Where a binding was expanded. */
export type UseSite =
    | {
          readonly kind: "argv";
          readonly invocation: Invocation;
          /** Indexes into the invocation's `fullArgv` this use landed on. */
          readonly argIndexes: readonly number[];
      }
    | { readonly kind: "assignment" }
    | { readonly kind: "redirect" }
    | { readonly kind: "other" };

export interface BindingUse {
    readonly binding: Binding;
    readonly part: ParameterExpansionPart;
    readonly doc: SourceDocument;
    readonly site: UseSite;
}

/**
 * A binding use found while expanding a word, before it can be attributed to an
 * invocation (`indexes` are relative to the word's own args).
 */
export interface PendingUse {
    readonly binding: Binding;
    readonly part: ParameterExpansionPart;
    readonly doc: SourceDocument;
    readonly indexes: readonly number[];
}
