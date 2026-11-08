/**
 * How a command list stops. A list parser keeps reading `;`/`&`/newline
 * separated commands until it reaches a reserved word (e.g. `fi`, `done`), a
 * closing `)`, a `case` item terminator, or `]]`.
 */

export interface Stops {
    readonly words: readonly string[];
    readonly closeParen: boolean;
    readonly caseTerminator: boolean;
    readonly closeBracket: boolean;
}

export function stops(partial: Partial<Stops>): Stops {
    return {
        words: partial.words ?? [],
        closeParen: partial.closeParen ?? false,
        caseTerminator: partial.caseTerminator ?? false,
        closeBracket: partial.closeBracket ?? false,
    };
}

export const EMPTY_STOPS: Stops = stops({});

export const PAREN_STOPS: Stops = stops({ closeParen: true });
