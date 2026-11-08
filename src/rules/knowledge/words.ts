/**
 * Tiny shared helpers over command-line words, so the Python and Node
 * command-line knowledge spell options the same way.
 */

/** Whether `word` is an option (`-…`), but not the lone `-` (stdin). */
export function isOption(word: string): boolean {
    return word.startsWith("-") && word !== "-";
}
