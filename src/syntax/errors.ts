/**
 * Parse failures. `Parser.parse` never throws; it catches the internal
 * `ParseAbort` control-flow signal and returns a `ParseError`.
 */

import type { Span } from "./source.ts";

export interface ParseError {
    readonly message: string;
    /** The offending source range, always inside the parsed document. */
    readonly span: Span;
}

/** Internal control-flow exception used to unwind a failed parse. */
export class ParseAbort extends Error {
    readonly parseError: ParseError;

    constructor(error: ParseError) {
        super(error.message);
        this.name = "ParseAbort";
        this.parseError = error;
    }
}
