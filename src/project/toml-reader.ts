/**
 * A small, tolerant, purpose-built TOML reader.
 *
 * bashlight only needs to answer a handful of questions about `pyproject.toml`,
 * `Pipfile` and lock files (does a section exist? what keys does a table have?
 * which dependency strings are listed?), so a full TOML implementation would be
 * a dependency we do not want. This reader understands sections, arrays of
 * tables, dotted keys, arrays, inline tables, the three string flavours and
 * comments; on malformed input it keeps whatever it managed to read instead of
 * throwing.
 */

import { isObject } from "./json.ts";

export type TomlValue = string | number | boolean | readonly TomlValue[] | TomlTable;

export interface TomlTable {
    readonly [key: string]: TomlValue;
}

/** Mutable shapes used only while parsing. */
type MutableValue = string | number | boolean | MutableValue[] | MutableTable;

type MutableTable = { [key: string]: MutableValue };

const BARE_KEY = /[A-Za-z0-9_-]/;
const INTEGER = /^[+-]?\d+$/;
const FLOAT = /^[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?$/;

/**
 * The single "this is a TOML table" predicate (non-null, non-array object). It
 * narrows to the mutable internal shape so the parser and the query layer share
 * it; the public API only ever exposes the readonly types.
 */
function isTable(value: unknown): value is MutableTable {
    return isObject(value);
}

/** The single "this is a TOML array" predicate. */
function isArray(value: unknown): value is MutableValue[] {
    return Array.isArray(value);
}

/** Interprets an unquoted scalar as boolean, number or plain string. */
function interpretBareValue(raw: string): MutableValue {
    let value: MutableValue = raw;
    if (raw === "true") {
        value = true;
    } else if (raw === "false") {
        value = false;
    } else if (INTEGER.test(raw)) {
        value = Number.parseInt(raw, 10);
    } else if (FLOAT.test(raw)) {
        value = Number.parseFloat(raw);
    }
    return value;
}

/** Child of a table value, or `undefined` when `value` is not a table. */
function childOf(value: TomlValue | undefined, key: string): TomlValue | undefined {
    let child: TomlValue | undefined;
    if (isTable(value)) {
        child = value[key];
    }
    return child;
}

/** The values that `tables()` should consider: the array itself, or the table. */
function tableCandidates(value: TomlValue | undefined): readonly TomlValue[] {
    const arrays = isArray(value) ? value : [];
    const tables = isTable(value) ? [value] : [];
    return [...arrays, ...tables];
}

class TomlParser {
    private index = 0;
    private readonly root: MutableTable = {};
    private current: MutableTable = this.root;

    constructor(private readonly text: string) {}

    parse(): TomlTable {
        while (this.index < this.text.length) {
            this.skipBlank();
            if (this.index >= this.text.length) {
                break;
            }
            if (this.charAt(this.index) === "[") {
                this.readHeader();
            } else {
                this.readKeyValue(this.current);
            }
        }
        return this.root;
    }

    private readHeader(): void {
        this.index += 1;
        const arrayOfTables = this.charAt(this.index) === "[";
        if (arrayOfTables) {
            this.index += 1;
        }
        const keys = this.readKey("]");
        this.expect("]");
        if (arrayOfTables) {
            this.expect("]");
        }
        if (keys.length === 0) {
            return;
        }
        if (arrayOfTables) {
            const parent = this.navigate(this.root, keys.slice(0, -1));
            const name = keys[keys.length - 1];
            if (name !== undefined) {
                this.appendTable(parent, name);
            }
        } else {
            this.current = this.navigate(this.root, keys);
        }
    }

    private appendTable(parent: MutableTable, name: string): void {
        const table: MutableTable = {};
        const existing = parent[name];
        if (isArray(existing)) {
            existing.push(table);
        } else {
            parent[name] = [table];
        }
        this.current = table;
    }

    /** Resolves (creating as needed) the table addressed by `keys`. */
    private navigate(from: MutableTable, keys: readonly string[]): MutableTable {
        let table = from;
        for (const key of keys) {
            const value = table[key];
            if (isArray(value)) {
                table = this.lastElementOrCreate(value);
            } else if (isTable(value)) {
                table = value;
            } else {
                const created: MutableTable = {};
                table[key] = created;
                table = created;
            }
        }
        return table;
    }

    private lastElementOrCreate(list: MutableValue[]): MutableTable {
        const last = list[list.length - 1];
        if (isTable(last)) {
            return last;
        }
        const created: MutableTable = {};
        list.push(created);
        return created;
    }

    private readKeyValue(target: MutableTable): void {
        const [keys, value] = this.readKeyValuePair();
        this.assign(target, keys, value);
    }

    private readKeyValuePair(): readonly [readonly string[], MutableValue] {
        const keys = this.readKey("=");
        this.skipSpaces();
        if (this.charAt(this.index) === "=") {
            this.index += 1;
        }
        this.skipSpaces();
        return [keys, this.readValue()];
    }

    private assign(
        target: MutableTable,
        keys: readonly string[],
        value: MutableValue,
    ): void {
        if (keys.length === 0) {
            return;
        }
        const table = this.navigate(target, keys.slice(0, -1));
        const last = keys[keys.length - 1];
        if (last !== undefined) {
            table[last] = value;
        }
    }

    private readKey(terminator: string): string[] {
        const keys: string[] = [];
        for (;;) {
            this.skipSpaces();
            const ch = this.charAt(this.index);
            if (ch === "" || ch === terminator) {
                break;
            }
            const key =
                ch === '"' || ch === "'" ? this.readString(ch) : this.readBareKey();
            if (key !== "") {
                keys.push(key);
            }
            this.skipSpaces();
            if (this.charAt(this.index) === ".") {
                this.index += 1;
                continue;
            }
            break;
        }
        return keys;
    }

    private readBareKey(): string {
        const start = this.index;
        while (
            this.index < this.text.length &&
            BARE_KEY.test(this.charAt(this.index))
        ) {
            this.index += 1;
        }
        return this.text.slice(start, this.index);
    }

    private readValue(): MutableValue {
        const ch = this.charAt(this.index);
        let value: MutableValue;
        if (ch === '"' || ch === "'") {
            value = this.text.startsWith(ch.repeat(3), this.index)
                ? this.readMultilineString(ch)
                : this.readString(ch);
        } else if (ch === "[") {
            value = this.readArray();
        } else if (ch === "{") {
            value = this.readInlineTable();
        } else {
            value = this.readBareValue();
        }
        return value;
    }

    private readString(quote: string): string {
        this.index += 1;
        let result = "";
        while (this.index < this.text.length) {
            const ch = this.charAt(this.index);
            if (ch === quote) {
                this.index += 1;
                return result;
            }
            if (ch === "\\" && quote === '"') {
                this.index += 1;
                result += this.readEscape();
                continue;
            }
            result += ch;
            this.index += 1;
        }
        return result;
    }

    private readMultilineString(quote: string): string {
        this.index += 3;
        if (this.charAt(this.index) === "\n") {
            this.index += 1;
        }
        const close = quote.repeat(3);
        let result = "";
        while (this.index < this.text.length) {
            if (this.text.startsWith(close, this.index)) {
                this.index += 3;
                return result;
            }
            if (this.charAt(this.index) === "\\" && quote === '"') {
                this.index += 1;
                result += this.readEscape();
                continue;
            }
            result += this.charAt(this.index);
            this.index += 1;
        }
        return result;
    }

    private readEscape(): string {
        const ch = this.charAt(this.index);
        this.index += 1;
        switch (ch) {
            case "n":
                return "\n";
            case "t":
                return "\t";
            case "r":
                return "\r";
            case "b":
                return "\b";
            case "f":
                return "\f";
            case "u":
                return this.readUnicodeEscape(4);
            case "U":
                return this.readUnicodeEscape(8);
            case "\\":
                return "\\";
            case '"':
                return '"';
            default:
                return ch;
        }
    }

    private readUnicodeEscape(length: number): string {
        const hex = this.text.slice(this.index, this.index + length);
        this.index += length;
        const code = Number.parseInt(hex, 16);
        const inRange = Number.isInteger(code) && code >= 0 && code <= 0x10ffff;
        return inRange ? String.fromCodePoint(code) : "";
    }

    private readCommaSeparated<T>(close: string, readItem: () => T): T[] {
        this.index += 1;
        const items: T[] = [];
        for (;;) {
            this.skipBlank();
            const ch = this.charAt(this.index);
            if (ch === "") {
                break;
            }
            if (ch === close) {
                this.index += 1;
                break;
            }
            if (ch === ",") {
                this.index += 1;
                continue;
            }
            items.push(readItem());
        }
        return items;
    }

    private readArray(): MutableValue[] {
        return this.readCommaSeparated("]", () => this.readValue());
    }

    private readInlineTable(): MutableTable {
        const entries = this.readCommaSeparated("}", () => this.readKeyValuePair());
        const table: MutableTable = {};
        for (const [keys, value] of entries) {
            this.assign(table, keys, value);
        }
        return table;
    }

    private readBareValue(): MutableValue {
        const start = this.index;
        while (this.index < this.text.length) {
            const ch = this.charAt(this.index);
            if (
                ch === "," ||
                ch === "]" ||
                ch === "}" ||
                ch === "\n" ||
                ch === "\r" ||
                ch === "#"
            ) {
                break;
            }
            this.index += 1;
        }
        return interpretBareValue(this.text.slice(start, this.index).trim());
    }

    private skipBlank(): void {
        for (;;) {
            const ch = this.charAt(this.index);
            if (ch === "") {
                return;
            }
            if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
                this.index += 1;
                continue;
            }
            if (ch === "#") {
                this.skipComment();
                continue;
            }
            return;
        }
    }

    private skipComment(): void {
        while (this.index < this.text.length && this.charAt(this.index) !== "\n") {
            this.index += 1;
        }
    }

    private skipSpaces(): void {
        while (this.charAt(this.index) === " " || this.charAt(this.index) === "\t") {
            this.index += 1;
        }
    }

    private expect(ch: string): void {
        if (this.charAt(this.index) === ch) {
            this.index += 1;
        }
    }

    private charAt(index: number): string {
        return this.text.charAt(index);
    }
}

/** Parsed view of a TOML document with dotted-path lookups. */
export class TomlDocument {
    private constructor(private readonly root: TomlTable) {}

    static parse(text: string): TomlDocument {
        try {
            return new TomlDocument(new TomlParser(text).parse());
        } catch {
            return new TomlDocument({});
        }
    }

    /** Value at `path`, or `undefined`. */
    get(path: readonly string[]): TomlValue | undefined {
        let value: TomlValue | undefined = this.root;
        for (const key of path) {
            value = childOf(value, key);
        }
        return value;
    }

    /** Whether `path` addresses a table. */
    hasTable(path: readonly string[]): boolean {
        return isTable(this.get(path));
    }

    /** Keys of the table at `path`; empty when it is not a table. */
    childKeys(path: readonly string[]): readonly string[] {
        const value = this.get(path);
        return isTable(value) ? Object.keys(value) : [];
    }

    /** String elements of the array at `path`; empty when it is not an array. */
    stringList(path: readonly string[]): readonly string[] {
        const value = this.get(path);
        const items = isArray(value) ? value : [];
        return items.filter((item): item is string => typeof item === "string");
    }

    /** Tables at `path`: all elements of an array of tables, or the table itself. */
    tables(path: readonly string[]): readonly TomlTable[] {
        return tableCandidates(this.get(path)).filter(isTable);
    }
}
