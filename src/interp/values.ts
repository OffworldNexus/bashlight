/* eslint-disable sonarjs/function-return-type */
/**
 * The values expansion produces. A `Fragment` is a piece of text with a known
 * *origin* (source characters, a variable binding, a computed value, or an
 * unknown); an `Arg` is one shell word field, made of one or more fragments.
 *
 * Fragments keep the exact source spans of the characters they cover so the
 * rewriter can edit precisely, and the quoting context of those characters so
 * it knows how to re-quote a value.
 */

import type {
    Node,
    ParameterExpansionPart,
    SourceDocument,
    Span,
    Word,
} from "../syntax/index.ts";
import type { Binding } from "./binding.ts";

/** The quoting of the source characters a literal fragment covers. */
export type Quoting = "none" | "single" | "double" | "ansi-c" | "heredoc";

/** Where a fragment's text comes from. */
export type Origin =
    | {
          readonly kind: "literal";
          readonly doc: SourceDocument;
          readonly span: Span;
          readonly quoting: Quoting;
      }
    | {
          readonly kind: "binding";
          readonly binding: Binding;
          readonly part: ParameterExpansionPart;
      }
    | { readonly kind: "computed"; readonly node: Node }
    | { readonly kind: "unknown"; readonly node: Node; readonly reason: string };

export interface Fragment {
    /** The decoded text, or `undefined` when statically unknown. */
    readonly text: string | undefined;
    readonly origin: Origin;
    /**
     * Bindings this fragment *reads* even though its value is computed
     * (`${#P}`, `${P:-x}`, `$((P+1))`…). The rewriter refuses to fold a
     * binding when any of its uses is not a plain `$P` field.
     */
    readonly reads?: readonly Read[];
}

/** A variable read that produced a computed value. */
export interface Read {
    readonly binding: Binding;
    readonly part: Node;
}

/** Where an arg sits in the field splitting of its word. */
export interface ArgField {
    /** Zero-based index of this field within the word. */
    readonly index: number;
    /**
     * How many fields the word produced; `undefined` when an unknown unquoted
     * expansion may split into any number of fields.
     */
    readonly count: number | undefined;
}

export interface Arg {
    readonly fragments: readonly Fragment[];
    /** The join of the fragments, or `undefined` when any of them is unknown. */
    readonly value: string | undefined;
    /** The source word this arg came from. */
    readonly word: Word;
    readonly doc: SourceDocument;
    readonly field: ArgField;
    /** Whether the word contains unquoted glob characters. */
    readonly glob: boolean;
}

/** Joins the fragments, returning `undefined` if any text is unknown. */
export function fragmentsValue(fragments: readonly Fragment[]): string | undefined {
    let out = "";
    for (const fragment of fragments) {
        if (fragment.text === undefined) {
            return undefined;
        }
        out += fragment.text;
    }
    return out;
}

export function literalFragment(
    text: string,
    doc: SourceDocument,
    span: Span,
    quoting: Quoting,
): Fragment {
    return { text, origin: { kind: "literal", doc, span, quoting } };
}

export function computedFragment(text: string, node: Node): Fragment {
    return { text, origin: { kind: "computed", node } };
}

export function unknownFragment(node: Node, reason: string): Fragment {
    return { text: undefined, origin: { kind: "unknown", node, reason } };
}

export function bindingFragment(
    text: string | undefined,
    binding: Binding,
    part: ParameterExpansionPart,
): Fragment {
    return { text, origin: { kind: "binding", binding, part } };
}

export function makeArg(
    word: Word,
    doc: SourceDocument,
    fragments: readonly Fragment[],
    index: number,
    count: number | undefined,
    glob: boolean,
): Arg {
    return {
        fragments,
        value: fragmentsValue(fragments),
        word,
        doc,
        field: { index, count },
        glob,
    };
}

/**
 * The binding this arg is entirely made of, when there is exactly one.
 *
 * Kept for the rewriter's "binding edit" strategy (rewrite a run of replaced
 * args in the assignment of the variable they all come from).
 */
export function soleBinding(arg: Arg): Binding | undefined {
    const first = arg.fragments[0];
    if (first === undefined || first.origin.kind !== "binding") {
        return undefined;
    }
    const binding = first.origin.binding;
    return arg.fragments.every(
        (fragment) =>
            fragment.origin.kind === "binding" && fragment.origin.binding === binding,
    )
        ? binding
        : undefined;
}
