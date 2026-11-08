/* eslint-disable sonarjs/function-return-type */
/**
 * A small hand-written argv parser shared by every command.
 *
 * It understands `--x` (boolean), `--x=v`, `--x v` (value), `--x` aliases,
 * positionals, `--` to end options, and `--help`/`-h` everywhere. In
 * `unknownAsPositional` mode (used by `explain`, whose command itself contains
 * dashes) an unrecognized option token becomes a positional instead of an
 * error.
 */

/** One accepted flag. `name` is written without leading dashes. */
export interface FlagSpec {
    readonly name: string;
    readonly aliases?: readonly string[];
    /** True when the flag consumes a value (`--log PATH`, `--log=PATH`). */
    readonly value?: boolean;
}

/** The flags and positionals extracted from one argv. */
export interface ParsedFlags {
    /** Whether `name` appeared at all. */
    has(name: string): boolean;
    /** Whether a boolean flag is set (`--all`). */
    bool(name: string): boolean;
    /** The last value given for a value flag, or `undefined`. */
    value(name: string): string | undefined;
    readonly positionals: readonly string[];
}

export interface ParseOptions {
    /**
     * Treat an unrecognized option token as a positional instead of an error.
     * Used by `explain`, whose command legitimately contains dashes (`pip
     * install -r req.txt`); recognized flags are still stripped and may appear
     * before or after the command. `--` still ends option parsing.
     */
    readonly unknownAsPositional?: boolean;
}

export type ParseResult =
    | { readonly ok: true; readonly flags: ParsedFlags }
    | { readonly ok: false; readonly error: string };

class Flags implements ParsedFlags {
    constructor(
        private readonly present: ReadonlySet<string>,
        private readonly values: ReadonlyMap<string, string>,
        readonly positionals: readonly string[],
    ) {}

    has(name: string): boolean {
        return this.present.has(name);
    }

    bool(name: string): boolean {
        return this.present.has(name);
    }

    value(name: string): string | undefined {
        return this.values.get(name);
    }
}

const HELP: FlagSpec = { name: "help", aliases: ["h"] };

/** Maps every accepted spelling (without dashes) to its spec. */
function indexFlags(specs: readonly FlagSpec[]): ReadonlyMap<string, FlagSpec> {
    const index = new Map<string, FlagSpec>();
    for (const spec of [...specs, HELP]) {
        index.set(spec.name, spec);
        for (const alias of spec.aliases ?? []) {
            index.set(alias, spec);
        }
    }
    return index;
}

/** Strips the dashes of a long (`--x`) or short (`-x`) option. */
function optionName(token: string): string {
    return token.startsWith("--") ? token.slice(2) : token.slice(1);
}

interface ParsedOption {
    readonly spec: FlagSpec;
    readonly inline: string | undefined;
}

/** Resolves one option token to its spec and any `=value`, or `undefined`. */
function parseOption(
    index: ReadonlyMap<string, FlagSpec>,
    token: string,
): ParsedOption | undefined {
    const body = optionName(token);
    const equals = body.indexOf("=");
    const name = equals === -1 ? body : body.slice(0, equals);
    const spec = index.get(name);
    if (spec === undefined) {
        return undefined;
    }
    return { spec, inline: equals === -1 ? undefined : body.slice(equals + 1) };
}

type Consumed =
    | {
          readonly ok: true;
          readonly spec: FlagSpec;
          readonly value?: string;
          /** The next index to resume the loop at. */
          readonly next: number;
      }
    | { readonly ok: false; readonly error: string };

/** Consumes one recognized option (and its value), or reports a usage error. */
function consume(
    parsed: ParsedOption,
    args: readonly string[],
    position: number,
): Consumed {
    const { spec, inline } = parsed;
    if (spec.value !== true) {
        return inline === undefined
            ? { ok: true, spec, next: position + 1 }
            : { ok: false, error: `option '--${spec.name}' takes no value` };
    }
    if (inline !== undefined) {
        return { ok: true, spec, value: inline, next: position + 1 };
    }
    const next = args[position + 1];
    return next === undefined
        ? { ok: false, error: `option '--${spec.name}' expects a value` }
        : { ok: true, spec, value: next, next: position + 2 };
}

/** Parses `args` against `specs`; never throws. */
export function parseArgv(
    args: readonly string[],
    specs: readonly FlagSpec[],
    options: ParseOptions = {},
): ParseResult {
    const index = indexFlags(specs);
    const present = new Set<string>();
    const values = new Map<string, string>();
    const positionals: string[] = [];
    let position = 0;
    while (position < args.length) {
        const token = args[position] ?? "";
        if (token === "--") {
            positionals.push(...args.slice(position + 1));
            break;
        }
        if (token === "-" || !token.startsWith("-")) {
            positionals.push(token);
            position += 1;
            continue;
        }
        const parsed = parseOption(index, token);
        if (parsed === undefined) {
            if (options.unknownAsPositional !== true) {
                return { ok: false, error: `unknown option '${token}'` };
            }
            positionals.push(token);
            position += 1;
            continue;
        }
        const consumed = consume(parsed, args, position);
        if (!consumed.ok) {
            return { ok: false, error: consumed.error };
        }
        if (consumed.value !== undefined) {
            values.set(consumed.spec.name, consumed.value);
        }
        present.add(consumed.spec.name);
        position = consumed.next;
    }
    return { ok: true, flags: new Flags(present, values, positionals) };
}
