/**
 * Character-level cursor over a document. Deliberately dumb: it only knows how
 * to read characters. All bash-specific knowledge lives in the parser layers
 * built on top of it.
 */

export class Scanner {
    readonly text: string;
    pos: number;

    constructor(text: string) {
        this.text = text;
        this.pos = 0;
    }

    get length(): number {
        return this.text.length;
    }

    atEnd(): boolean {
        return this.pos >= this.text.length;
    }

    /** The character at `pos + offset`, or `""` past the end. */
    peek(offset = 0): string {
        return this.text[this.pos + offset] ?? "";
    }

    advance(count = 1): void {
        this.pos += count;
    }

    match(text: string): boolean {
        return this.text.startsWith(text, this.pos);
    }

    slice(start: number, end: number): string {
        return this.text.slice(start, end);
    }
}
