/**
 * Per-parse mutable state. A `ParseSession` is created for every `Parser.parse`
 * call, so the `Parser` itself stays stateless and reusable and there is no
 * module-level mutable state. All the recursive-descent helpers take the session
 * as their first argument; its own bookkeeping (nesting counters, pending
 * heredocs, comment scopes) is private.
 */

import type { HereDoc } from "./ast.ts";
import { ParseAbort } from "./errors.ts";
import { Scanner } from "./scanner.ts";
import type { SourceDocument, Span } from "./source.ts";

/** A heredoc whose body has not been read yet, in source order. */
export interface PendingHeredoc {
    /** The provisional node currently referenced by the redirect. */
    readonly placeholder: HereDoc;
    readonly delimiter: string;
    readonly quoted: boolean;
    readonly stripTabs: boolean;
}

export class ParseSession {
    readonly doc: SourceDocument;
    readonly scanner: Scanner;
    readonly maxDepth: number;

    private depth: number;
    private backtickCount: number;
    private readingHeredocs: boolean;
    private readonly onNewline: (() => void) | undefined;
    private readonly pending: PendingHeredoc[];
    private readonly finalHeredocs: Map<HereDoc, HereDoc>;
    private readonly commentScopes: Span[][];

    constructor(doc: SourceDocument, maxDepth = 200, onNewline?: () => void) {
        this.doc = doc;
        this.scanner = new Scanner(doc.text);
        this.maxDepth = maxDepth;
        this.depth = 0;
        this.backtickCount = 0;
        this.readingHeredocs = false;
        this.onNewline = onNewline;
        this.pending = [];
        this.finalHeredocs = new Map();
        this.commentScopes = [[]];
    }

    get text(): string {
        return this.scanner.text;
    }

    get pos(): number {
        return this.scanner.pos;
    }

    set pos(value: number) {
        this.scanner.pos = value;
    }

    atEnd(): boolean {
        return this.scanner.atEnd();
    }

    peek(offset = 0): string {
        return this.scanner.peek(offset);
    }

    match(text: string): boolean {
        return this.scanner.match(text);
    }

    advance(count = 1): void {
        this.scanner.advance(count);
    }

    slice(start: number, end: number): string {
        return this.scanner.slice(start, end);
    }

    span(start: number, end: number): Span {
        return { start, end };
    }

    error(message: string, span?: Span): never {
        const s: Span = span ?? {
            start: this.scanner.pos,
            end: Math.min(this.scanner.pos + 1, this.scanner.text.length),
        };
        throw new ParseAbort({ message, span: s });
    }

    // --- nesting counters ---------------------------------------------------

    enter(): void {
        this.depth += 1;
        if (this.depth > this.maxDepth) {
            this.error("maximum nesting depth exceeded");
        }
    }

    leave(): void {
        this.depth -= 1;
    }

    enterBacktick(): void {
        this.backtickCount += 1;
    }

    leaveBacktick(): void {
        this.backtickCount -= 1;
    }

    inBacktick(): boolean {
        return this.backtickCount > 0;
    }

    // --- comments -----------------------------------------------------------

    pushCommentScope(): Span[] {
        const scope: Span[] = [];
        this.commentScopes.push(scope);
        return scope;
    }

    popCommentScope(): Span[] {
        return this.commentScopes.pop() ?? [];
    }

    addComment(span: Span): void {
        this.commentScopes[this.commentScopes.length - 1]?.push(span);
    }

    consumeComment(): Span {
        const start = this.pos;
        while (!this.atEnd() && this.peek() !== "\n") {
            this.advance(1);
        }
        const span = this.span(start, this.pos);
        this.addComment(span);
        return span;
    }

    // --- whitespace ---------------------------------------------------------

    /** Spaces, tabs and `\`+newline (never a newline or `\r`). */
    skipBlanks(): void {
        for (;;) {
            const c = this.peek();
            if (c === " " || c === "\t") {
                this.advance(1);
                continue;
            }
            if (c === "\\" && this.peek(1) === "\n") {
                this.advance(2);
                continue;
            }
            break;
        }
    }

    /** Blanks, line continuations, newlines and comments (command boundaries). */
    skipSeparators(): void {
        for (;;) {
            this.skipBlanks();
            const c = this.peek();
            if (c === "\n") {
                this.consumeNewline();
                continue;
            }
            if (c === "#") {
                this.consumeComment();
                continue;
            }
            break;
        }
    }

    consumeNewline(): void {
        this.advance(1);
        this.onNewline?.();
    }

    // --- heredocs -----------------------------------------------------------

    addPendingHeredoc(pending: PendingHeredoc): void {
        this.pending.push(pending);
    }

    shiftPendingHeredoc(): PendingHeredoc | undefined {
        return this.pending.shift();
    }

    hasPendingHeredocs(): boolean {
        return this.pending.length > 0;
    }

    /** True when no heredoc body is being read (guards against re-entrancy). */
    beginHeredocRead(): boolean {
        if (this.readingHeredocs) {
            return false;
        }
        this.readingHeredocs = true;
        return true;
    }

    endHeredocRead(): void {
        this.readingHeredocs = false;
    }

    recordHeredocFinal(placeholder: HereDoc, final: HereDoc): void {
        this.finalHeredocs.set(placeholder, final);
    }

    heredocFinals(): ReadonlyMap<HereDoc, HereDoc> {
        return this.finalHeredocs;
    }
}
