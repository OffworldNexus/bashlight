// Balancing brackets is inherently branchy.
/* eslint-disable sonarjs/cognitive-complexity */
/**
 * Text-level balanced scanning. One implementation handles every bracketed
 * region the parser skips over (`$(( … ))`, `$[ … ]`, `(( … ))`, `for (( … ))`),
 * honouring quotes and backslash escapes so `(( x = "a)" ))` is scanned right.
 */

export interface ScanResult {
    /** Index just past the terminator (or `text.length` when unterminated). */
    readonly end: number;
    readonly terminated: boolean;
}

/**
 * The index just past the quote starting at `index`. Inside `'…'` a backslash
 * is literal; inside `"…"` it escapes the next character.
 */
export function skipQuoted(text: string, index: number): number {
    const quote = text[index];
    let i = index + 1;
    if (quote === "'") {
        while (i < text.length && text[i] !== "'") {
            i += 1;
        }
        return Math.min(i + 1, text.length);
    }
    while (i < text.length && text[i] !== quote) {
        if (text[i] === "\\") {
            i += 1;
        }
        i += 1;
    }
    return Math.min(i + 1, text.length);
}

function skipBackticks(text: string, index: number): number {
    let i = index + 1;
    while (i < text.length && text[i] !== "`" && text[i] !== "\n") {
        if (text[i] === "\\") {
            i += 1;
        }
        i += 1;
    }
    return Math.min(i + 1, text.length);
}

/**
 * Scans a balanced region from `start` (just after the opening token) up to the
 * terminator. `open`/`close` nest; when `doubled` is set the depth-zero
 * terminator is `close + close` (`))`), which is how arithmetic ends.
 */
export function scanDelimited(
    text: string,
    start: number,
    open: string,
    close: string,
    doubled: boolean,
): ScanResult {
    let i = start;
    let depth = 0;
    while (i < text.length) {
        const ch = text[i];
        if (ch === "\\") {
            i += 2;
            continue;
        }
        if (ch === "'" || ch === '"') {
            i = skipQuoted(text, i);
            continue;
        }
        if (ch === "`") {
            i = skipBackticks(text, i);
            continue;
        }
        if (ch === open) {
            depth += 1;
            i += 1;
            continue;
        }
        if (ch === close) {
            if (depth > 0) {
                depth -= 1;
                i += 1;
                continue;
            }
            if (!doubled) {
                return { end: i + 1, terminated: true };
            }
            if (text[i + 1] === close) {
                return { end: i + 2, terminated: true };
            }
            i += 1;
            continue;
        }
        i += 1;
    }
    return { end: text.length, terminated: false };
}
