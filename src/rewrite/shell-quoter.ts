/**
 * Minimal, safe shell quoting for a value in a given source context.
 *
 * `unquoted` produces a complete word that, when read back by the shell,
 * yields exactly the value. `double`/`single` are used when splicing text into
 * an already-quoted word (nested-document rewriting): they only escape the
 * characters that would otherwise be interpreted, and do not add quotes.
 */

export type QuoteContext = "unquoted" | "double" | "single";

/** Characters that never need quoting in an unquoted context. */
const BARE = /^[A-Za-z0-9_@%+=:,./-]+$/;

export class ShellQuoter {
    quote(value: string, context: QuoteContext = "unquoted"): string {
        if (context === "single") {
            return value.replaceAll("'", "'\\''");
        }
        if (context === "double") {
            return value.replace(/[\\$`"]/g, "\\$&");
        }
        if (value === "") {
            return "''";
        }
        if (BARE.test(value) && !value.startsWith("~") && !value.startsWith("#")) {
            return value;
        }
        return `'${value.replaceAll("'", "'\\''")}'`;
    }

    /** Quotes each value and joins them with single spaces. */
    join(values: readonly string[], context: QuoteContext = "unquoted"): string {
        return values.map((value) => this.quote(value, context)).join(" ");
    }
}
