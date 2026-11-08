/* eslint-disable sonarjs/function-return-type */
/**
 * A `ScriptDocument` is a `SourceDocument` that also knows how it was nested:
 * a script read from a `bash -c '…'` argument, from several `ssh host a b`
 * words joined with spaces, or from a heredoc piped into a shell. The nesting
 * lets the rewriter walk from an inner document back to what to edit in the
 * outer one.
 */

import type { Redirect, SourceDocument, Span } from "../syntax/index.ts";
import { createSourceDocument, type NestedOrigin } from "../syntax/index.ts";
import type { Invocation } from "./invocation.ts";
import type { Arg } from "./values.ts";

export type Nesting =
    | {
          readonly kind: "argument";
          readonly invocation: Invocation;
          readonly arg: Arg;
      }
    | {
          readonly kind: "joined-arguments";
          readonly invocation: Invocation;
          readonly args: readonly Arg[];
      }
    | {
          readonly kind: "heredoc";
          readonly invocation: Invocation;
          readonly redirect: Redirect | undefined;
      };

export interface ScriptDocument extends SourceDocument {
    /** `undefined` for the top-level document. */
    readonly nesting: Nesting | undefined;
}

/**
 * The `ScriptDocument` a document was nested in, when there is one. The
 * interpreter only ever nests `ScriptDocument`s, so this narrows the parent
 * without a cast at every call site.
 */
export function parentDocument(doc: SourceDocument): ScriptDocument | undefined {
    const parent = doc.parent?.doc;
    return parent !== undefined && "nesting" in parent
        ? (parent as ScriptDocument)
        : undefined;
}

export function createScriptDocument(
    text: string,
    options: { readonly parent?: NestedOrigin; readonly nesting?: Nesting } = {},
): ScriptDocument {
    const base = createSourceDocument(text, options.parent);
    return { ...base, nesting: options.nesting };
}

/** The text a nested script is read from, plus how to find it in the parent. */
export type ScriptSource =
    | { readonly kind: "arg"; readonly arg: Arg }
    | { readonly kind: "joined"; readonly args: readonly Arg[] }
    | {
          readonly kind: "heredoc";
          readonly text: string;
          readonly span: Span;
          readonly redirect: Redirect | undefined;
      };

export interface PreparedSource {
    readonly text: string;
    readonly parent: {
        readonly doc: ScriptDocument;
        readonly span: Span;
    };
    readonly nesting: Nesting;
}

/**
 * Resolves a `ScriptSource` to the text to parse and the nesting that links the
 * resulting document back to the outer one; `undefined` when part of it is
 * statically unknown.
 */
export function prepareScriptSource(
    source: ScriptSource,
    invocation: Invocation,
): PreparedSource | undefined {
    if (source.kind === "arg") {
        if (source.arg.value === undefined) {
            return undefined;
        }
        return {
            text: source.arg.value,
            parent: { doc: invocation.doc, span: source.arg.word.span },
            nesting: { kind: "argument", invocation, arg: source.arg },
        };
    }
    if (source.kind === "joined") {
        const values = stringValues(source.args);
        const first = source.args[0];
        const last = source.args[source.args.length - 1];
        if (values === undefined || first === undefined || last === undefined) {
            return undefined;
        }
        return {
            text: values.join(" "),
            parent: {
                doc: invocation.doc,
                span: { start: first.word.span.start, end: last.word.span.end },
            },
            nesting: { kind: "joined-arguments", invocation, args: source.args },
        };
    }
    return {
        text: source.text,
        parent: { doc: invocation.doc, span: source.span },
        nesting: { kind: "heredoc", invocation, redirect: source.redirect },
    };
}

/**
 * The values of `args` when every one is known; `undefined` when any is not.
 * An empty list yields an empty array.
 */
export function stringValues(args: readonly Arg[]): string[] | undefined {
    const values: string[] = [];
    for (const arg of args) {
        if (arg.value === undefined) {
            return undefined;
        }
        values.push(arg.value);
    }
    return values;
}
