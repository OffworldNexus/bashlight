/**
 * The source a script is parsed from. Every span in the AST is a UTF-16 half-open
 * range `[start, end)` into a `SourceDocument.text`. Nested scripts (a `$(…)`,
 * a backtick, a heredoc body) are parsed against the *same* text, so their spans
 * stay absolute and directly usable by later rewrite stages.
 */

export interface Span {
    readonly start: number;
    readonly end: number;
}

/**
 * Where a nested script text came from: the outer document and the span of the
 * argument it was read from (`bash -c '…'`, `ssh host '…'`, `eval '…'`). The
 * parser itself only produces nested origins when a caller supplies them; the
 * syntax module never guesses.
 */
export interface NestedOrigin {
    readonly doc: SourceDocument;
    readonly span: Span;
}

export interface SourceDocument {
    readonly text: string;
    readonly parent?: NestedOrigin;
}

export function createSourceDocument(
    text: string,
    parent?: NestedOrigin,
): SourceDocument {
    return parent === undefined ? { text } : { text, parent };
}
