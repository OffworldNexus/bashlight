/* eslint-disable sonarjs/function-return-type */
import { basename } from "../shared/posix-path.ts";
import type { FileSystem } from "./file-system.ts";

/**
 * A parsed `#!` line.
 *
 * `interpreter` is the command the kernel will actually execute: for
 * `#!/usr/bin/env python3` it is `python3` (env resolves it through `PATH`),
 * for `#!/usr/bin/python3` it is the absolute `/usr/bin/python3` as written.
 */
export interface Shebang {
    /** The program to run (basename for `env`, as written otherwise). */
    readonly interpreter: string;
    /** The arguments that follow the interpreter on the shebang line. */
    readonly args: readonly string[];
    /** Whether the interpreter was resolved through `env`. */
    readonly viaEnv: boolean;
    /** The raw shebang line, including `#!`. */
    readonly raw: string;
}

/** Reads the shebang of script files (`./manage.py`, `bin/cli`…). */
export interface ScriptInspector {
    /** The shebang of the script at `path` (absolute), if any. */
    shebang(path: string): Shebang | undefined;
}

const DEFAULT_MAX_BYTES = 256;
const ENV_COMMAND = "env";
const ENV_FLAGS: ReadonlySet<string> = new Set([
    "-i",
    "--ignore-environment",
    "-0",
    "--null",
    "-v",
    "--debug",
    "-S",
    "--split-string",
]);
const ENV_VALUE_OPTIONS: readonly string[] = ["-u", "--unset", "-C", "--chdir"];
const ASSIGNMENT = /^[A-Za-z]\w*\+?=/;

/** Trims surrounding single/double quotes from a shebang word. */
function unquote(word: string): string {
    if (word.length >= 2) {
        const first = word.charAt(0);
        const last = word.charAt(word.length - 1);
        if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
            return word.slice(1, -1);
        }
    }
    return word;
}

function firstLine(head: string): string {
    const end = head.indexOf("\n");
    const line = end < 0 ? head : head.slice(0, end);
    return line.endsWith("\r") ? line.slice(0, -1) : line;
}

/**
 * Parses a leading `#!` line. Returns `undefined` for files without a shebang,
 * for binary heads (they contain a NUL) and for `env` lines with no program.
 */
export function parseShebang(head: string): Shebang | undefined {
    if (!head.startsWith("#!")) {
        return undefined;
    }
    const raw = firstLine(head);
    if (raw.includes("\u0000")) {
        return undefined;
    }
    const words = raw
        .slice(2)
        .trim()
        .split(/\s+/)
        .filter((word) => word !== "")
        .map(unquote);
    const interpreter = words[0];
    if (interpreter === undefined) {
        return undefined;
    }
    if (basename(interpreter) === ENV_COMMAND) {
        return parseEnv(words.slice(1), raw);
    }
    return { interpreter, args: words.slice(1), viaEnv: false, raw };
}

function parseEnv(words: readonly string[], raw: string): Shebang | undefined {
    let index = 0;
    while (index < words.length) {
        const word = words[index];
        if (word === undefined) {
            break;
        }
        if (word === "--") {
            index += 1;
            break;
        }
        if (ENV_FLAGS.has(word) || word.startsWith("--split-string=")) {
            index += 1;
            continue;
        }
        if (ENV_VALUE_OPTIONS.includes(word)) {
            index += 2;
            continue;
        }
        if (ASSIGNMENT.test(word)) {
            index += 1;
            continue;
        }
        break;
    }
    const interpreter = words[index];
    if (interpreter === undefined) {
        return undefined;
    }
    return {
        interpreter,
        args: words.slice(index + 1),
        viaEnv: true,
        raw,
    };
}

/**
 * `ScriptInspector` over a `FileSystem`, memoizing per path. One instance is
 * created per processed command (like `ProjectInspector`); detection reads the
 * disk.
 */
export class ShebangScriptInspector implements ScriptInspector {
    private readonly cache = new Map<string, Shebang | undefined>();

    constructor(
        private readonly fs: FileSystem,
        private readonly maxBytes = DEFAULT_MAX_BYTES,
    ) {}

    shebang(path: string): Shebang | undefined {
        if (!this.cache.has(path)) {
            const head = this.fs.readHead(path, this.maxBytes);
            this.cache.set(path, head === undefined ? undefined : parseShebang(head));
        }
        return this.cache.get(path);
    }
}

/** Builds the default script inspector over `fs`. */
export function createScriptInspector(
    fs: FileSystem,
    maxBytes = DEFAULT_MAX_BYTES,
): ScriptInspector {
    return new ShebangScriptInspector(fs, maxBytes);
}
