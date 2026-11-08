// Word expansion is inherently branchy (one case per word-part kind).
/* eslint-disable sonarjs/cognitive-complexity, sonarjs/function-return-type */
/**
 * `WordExpander` turns an AST `Word` into `Arg`s: tilde, brace, parameter,
 * command/process substitution and arithmetic expansion, then field splitting.
 *
 * A per-word `WordExpansion` holds the parts that stay fixed (`doc`, `scope`,
 * the field builder, the running state), so the recursive methods only take
 * what actually varies. Command/process substitutions are *collected* (not
 * run) so the caller can execute them in order, before the command they belong
 * to; the expander itself never touches the AST walk.
 */

import type {
    ArithmeticExpansionPart,
    BraceExpansionPart,
    Node,
    ParameterExpansionPart,
    TildePart,
    Word,
    WordPart,
} from "../syntax/index.ts";
import { evaluateArithmetic } from "./arithmetic.ts";
import type { Binding, PendingUse } from "./binding.ts";
import type { ScriptDocument } from "./documents.ts";
import { readString, type Scope } from "./environment.ts";
import type { EmbeddedScript, ExpansionHost } from "./interfaces.ts";
import type { Fragment } from "./values.ts";
import {
    type Arg,
    bindingFragment,
    computedFragment,
    fragmentsValue,
    literalFragment,
    makeArg,
    type Quoting,
    unknownFragment,
} from "./values.ts";

export interface Expansion {
    readonly args: readonly Arg[];
    readonly uses: readonly PendingUse[];
    readonly embedded: readonly EmbeddedScript[];
}

export interface ExpandedValue {
    readonly fragments: readonly Fragment[];
    readonly value: string | undefined;
    readonly uses: readonly PendingUse[];
    readonly embedded: readonly EmbeddedScript[];
}

interface Desc {
    readonly fragment: Fragment;
    readonly split: boolean;
}

interface State {
    glob: boolean;
    unknownCount: boolean;
}

interface ExpandOptions {
    /** Assignment values: no brace expansion, no glob flagging. */
    readonly assignment?: boolean;
}

type OperatorFamily =
    "default" | "removal" | "substitution" | "substring" | "case" | "transform";

const OPERATOR_FAMILY: ReadonlyMap<string, OperatorFamily> = new Map([
    [":-", "default"],
    ["-", "default"],
    [":=", "default"],
    ["=", "default"],
    [":+", "default"],
    ["+", "default"],
    [":?", "default"],
    ["?", "default"],
    ["#", "removal"],
    ["##", "removal"],
    ["%", "removal"],
    ["%%", "removal"],
    ["/", "substitution"],
    ["//", "substitution"],
    ["/#", "substitution"],
    ["/%", "substitution"],
    [":", "substring"],
    ["^", "case"],
    ["^^", "case"],
    [",", "case"],
    [",,", "case"],
]);

const SPECIAL_PARAMETERS: ReadonlySet<string> = new Set([
    "@",
    "*",
    "#",
    "?",
    "$",
    "!",
    "-",
]);

const DEFAULT_IFS = " \t\n";

function isSpecialParameter(name: string): boolean {
    return SPECIAL_PARAMETERS.has(name) || (name.length > 0 && /^\d+$/.test(name));
}

function quotingFor(quoted: boolean, kind: WordPart["kind"]): Quoting {
    if (kind === "SingleQuoted") {
        return "single";
    }
    if (kind === "AnsiCQuoted") {
        return "ansi-c";
    }
    return quoted ? "double" : "none";
}

/** Collects the hard fields of expanding one word (broken by `"$@"`). */
class FieldBuilder {
    readonly fields: Desc[][] = [[]];

    add(fragment: Fragment, split: boolean): void {
        this.current().push({ fragment, split });
    }

    breakField(): void {
        this.fields.push([]);
    }

    currentLength(): number {
        return this.current().length;
    }

    private current(): Desc[] {
        return this.fields[this.fields.length - 1] as Desc[];
    }
}

/** The pieces that stay fixed while expanding one word. */
class WordExpansion {
    constructor(
        readonly doc: ScriptDocument,
        readonly scope: Scope,
        readonly state: State,
        readonly embedded: EmbeddedScript[],
        readonly builder = new FieldBuilder(),
    ) {}
}

export class WordExpander {
    constructor(private readonly host: ExpansionHost) {}

    expandWord(
        word: Word,
        doc: ScriptDocument,
        scope: Scope,
        options: ExpandOptions = {},
    ): Expansion {
        const core = this.expandCore(word, doc, scope, options, true);
        const count = core.unknownCount ? undefined : core.fields.length;
        const args = core.fields.map((fragments, index) =>
            makeArg(word, doc, fragments, index, count, core.glob),
        );
        return { args, uses: collectUses(args, doc), embedded: core.embedded };
    }

    expandValue(
        word: Word,
        doc: ScriptDocument,
        scope: Scope,
        options: ExpandOptions = {},
    ): ExpandedValue {
        const core = this.expandCore(word, doc, scope, options, false);
        const fragments = core.fields[0] ?? [];
        return {
            fragments,
            value: fragmentsValue(fragments),
            uses: collectFragmentUses(fragments, doc),
            embedded: core.embedded,
        };
    }

    expandAssignmentValue(
        word: Word,
        doc: ScriptDocument,
        scope: Scope,
    ): ExpandedValue {
        return this.expandValue(prepareAssignmentValue(word), doc, scope, {
            assignment: true,
        });
    }

    // --- core ---------------------------------------------------------------

    private expandCore(
        word: Word,
        doc: ScriptDocument,
        scope: Scope,
        options: ExpandOptions,
        splitting: boolean,
    ): {
        fields: Fragment[][];
        glob: boolean;
        unknownCount: boolean;
        embedded: EmbeddedScript[];
    } {
        const combinations = braceCombinations(word.parts, options.assignment !== true);
        const fields: Fragment[][] = splitting ? [] : [[]];
        const state: State = { glob: false, unknownCount: false };
        const embedded: EmbeddedScript[] = [];
        for (const parts of combinations) {
            const expansion = new WordExpansion(doc, scope, state, embedded);
            this.expandParts(expansion, parts, false, options);
            if (splitting) {
                for (const descs of expansion.builder.fields) {
                    fields.push(...splitField(this, expansion, descs));
                }
            } else {
                for (const field of expansion.builder.fields) {
                    for (const desc of field) {
                        (fields[0] as Fragment[]).push(desc.fragment);
                    }
                }
            }
        }
        return { fields, glob: state.glob, unknownCount: state.unknownCount, embedded };
    }

    private expandParts(
        expansion: WordExpansion,
        parts: readonly WordPart[],
        quoted: boolean,
        options: ExpandOptions,
    ): void {
        for (const part of parts) {
            this.expandPart(expansion, part, quoted, options);
        }
    }

    private expandPart(
        expansion: WordExpansion,
        part: WordPart,
        quoted: boolean,
        options: ExpandOptions,
    ): void {
        const builder = expansion.builder;
        switch (part.kind) {
            case "Literal":
                builder.add(
                    literalFragment(
                        part.value,
                        expansion.doc,
                        part.span,
                        quotingFor(quoted, part.kind),
                    ),
                    false,
                );
                if (part.hasGlob && options.assignment !== true) {
                    expansion.state.glob = true;
                }
                return;
            case "SingleQuoted":
            case "AnsiCQuoted":
                builder.add(
                    literalFragment(
                        part.value,
                        expansion.doc,
                        part.span,
                        quotingFor(quoted, part.kind),
                    ),
                    false,
                );
                return;
            case "DoubleQuoted":
            case "LocaleQuoted": {
                const before = builder.currentLength();
                this.expandParts(expansion, part.parts, true, {});
                if (
                    builder.currentLength() === before &&
                    !containsPositionalAt(part.parts)
                ) {
                    builder.add(
                        literalFragment("", expansion.doc, part.span, "double"),
                        false,
                    );
                }
                return;
            }
            case "Tilde":
                this.expandTilde(expansion, part);
                return;
            case "ParameterExpansion":
                this.expandParameter(expansion, part, quoted);
                return;
            case "CommandSubstitution":
                expansion.embedded.push({ script: part.script, doc: expansion.doc });
                builder.add(unknownFragment(part, "command substitution"), !quoted);
                if (!quoted) {
                    expansion.state.glob = true;
                }
                return;
            case "ArithmeticExpansion":
                this.expandArithmetic(expansion, part, quoted);
                return;
            case "ProcessSubstitution":
                expansion.embedded.push({ script: part.script, doc: expansion.doc });
                builder.add(unknownFragment(part, "process substitution"), false);
                return;
            case "BraceExpansion": {
                if (options.assignment === true) {
                    const raw = expansion.doc.text.slice(
                        part.span.start,
                        part.span.end,
                    );
                    builder.add(
                        literalFragment(raw, expansion.doc, part.span, "none"),
                        false,
                    );
                    return;
                }
                const alternative = part.alternatives[0];
                if (alternative !== undefined) {
                    this.expandParts(expansion, alternative.parts, quoted, options);
                }
                return;
            }
        }
    }

    private expandTilde(expansion: WordExpansion, part: TildePart): void {
        if (part.user !== undefined) {
            expansion.builder.add(unknownFragment(part, `~${part.user}`), false);
            return;
        }
        const home = readString(expansion.scope.env.view(), "HOME");
        if (home === undefined) {
            expansion.builder.add(unknownFragment(part, "unknown HOME"), false);
        } else {
            expansion.builder.add(computedFragment(home, part), false);
        }
    }

    private expandArithmetic(
        expansion: WordExpansion,
        part: ArithmeticExpansionPart,
        quoted: boolean,
    ): void {
        const value = evaluateArithmetic(part.expression, (name) =>
            expansion.scope.env.lookup(name),
        );
        if (value === undefined) {
            this.addUnknown(expansion, part, quoted, "arithmetic");
            return;
        }
        expansion.builder.add(computedFragment(String(value), part), !quoted);
    }

    private expandParameter(
        expansion: WordExpansion,
        part: ParameterExpansionPart,
        quoted: boolean,
    ): void {
        if (part.length) {
            this.expandLength(expansion, part, quoted);
            return;
        }
        if (part.indirect) {
            this.addUnknown(expansion, part, quoted, "indirect expansion");
            return;
        }
        if (part.index !== undefined) {
            this.addUnknown(expansion, part, quoted, "array subscript");
            return;
        }
        if (isSpecialParameter(part.name)) {
            this.expandSpecial(expansion, part, quoted);
            return;
        }
        if (part.operator === undefined) {
            this.addVariable(expansion, part, quoted);
            return;
        }
        const family = OPERATOR_FAMILY.get(part.operator) ?? "transform";
        switch (family) {
            case "default":
                this.expandDefault(expansion, part, part.operator, quoted);
                return;
            case "removal":
                this.expandRemoval(expansion, part, part.operator, quoted);
                return;
            case "substitution":
                this.expandSubstitution(expansion, part, part.operator, quoted);
                return;
            case "substring":
                this.expandSubstring(expansion, part, quoted);
                return;
            case "case":
                this.expandCase(expansion, part, part.operator, quoted);
                return;
            case "transform":
                this.addUnknown(expansion, part, quoted, `\${${part.operator}}`);
                return;
        }
    }

    private expandLength(
        expansion: WordExpansion,
        part: ParameterExpansionPart,
        quoted: boolean,
    ): void {
        const name = part.name;
        if (name === "@" || name === "*") {
            if (expansion.scope.env.positionals === undefined) {
                this.addUnknown(expansion, part, quoted, "unknown $#");
                return;
            }
            expansion.builder.add(
                computedFragment(String(expansion.scope.env.positionals.length), part),
                false,
            );
            return;
        }
        const state = expansion.scope.env.lookup(name);
        if (state.kind === "set") {
            expansion.builder.add(
                computedFragment(String(state.value.length), part),
                false,
            );
        } else if (state.kind === "unset") {
            expansion.builder.add(computedFragment("0", part), false);
        } else {
            this.addUnknown(expansion, part, quoted, "unknown length");
        }
    }

    private expandSpecial(
        expansion: WordExpansion,
        part: ParameterExpansionPart,
        quoted: boolean,
    ): void {
        const name = part.name;
        if (name === "@" || name === "*") {
            this.expandPositionalAll(expansion, part, quoted);
            return;
        }
        if (/^\d+$/.test(name)) {
            this.expandPositionalIndex(
                expansion,
                part,
                quoted,
                Number.parseInt(name, 10),
            );
            return;
        }
        if (name === "#") {
            const positionals = expansion.scope.env.positionals;
            if (positionals === undefined) {
                this.addUnknown(expansion, part, quoted, "$#");
                return;
            }
            expansion.builder.add(
                computedFragment(String(positionals.length), part),
                false,
            );
            return;
        }
        this.addUnknown(expansion, part, quoted, `$${name}`);
    }

    private expandPositionalIndex(
        expansion: WordExpansion,
        part: ParameterExpansionPart,
        quoted: boolean,
        index: number,
    ): void {
        if (index === 0) {
            this.addUnknown(expansion, part, quoted, "$0");
            return;
        }
        const positionals = expansion.scope.env.positionals;
        const value = positionals?.[index - 1];
        if (positionals === undefined || value === undefined) {
            this.addUnknown(expansion, part, quoted, `$${index}`);
            return;
        }
        expansion.builder.add(computedFragment(value, part), !quoted);
    }

    private expandPositionalAll(
        expansion: WordExpansion,
        part: ParameterExpansionPart,
        quoted: boolean,
    ): void {
        const positionals = expansion.scope.env.positionals;
        if (positionals === undefined) {
            expansion.builder.add(unknownFragment(part, `$${part.name}`), !quoted);
            expansion.state.unknownCount = true;
            return;
        }
        if (part.name === "*") {
            const separator = firstIfsChar(this, expansion.scope) ?? " ";
            expansion.builder.add(
                computedFragment(positionals.join(separator), part),
                !quoted,
            );
            return;
        }
        positionals.forEach((value, index) => {
            if (index > 0) {
                expansion.builder.breakField();
            }
            expansion.builder.add(computedFragment(value, part), !quoted);
        });
    }

    private expandDefault(
        expansion: WordExpansion,
        part: ParameterExpansionPart,
        operator: string,
        quoted: boolean,
    ): void {
        const state = expansion.scope.env.lookup(part.name);
        if (state.kind === "unknown") {
            this.addUnknown(expansion, part, quoted, "unknown variable");
            return;
        }
        const colon = operator.startsWith(":");
        const isEmpty = state.kind === "set" && state.value === "";
        const unset = state.kind === "unset";
        const useDefault = colon ? unset || isEmpty : unset;
        const base = operator.replace(/^:/, "");
        if (base === "-") {
            if (useDefault) {
                this.addArgument(expansion, part, quoted);
            } else {
                this.addVariable(expansion, part, quoted);
            }
            return;
        }
        if (base === "+") {
            if (useDefault) {
                if (quoted) {
                    expansion.builder.add(computedFragment("", part), false);
                }
            } else {
                this.addArgument(expansion, part, quoted);
            }
            return;
        }
        if (base === "=") {
            if (useDefault) {
                const fragments = this.argumentFragments(expansion, part);
                this.host.assignBinding(expansion.scope, part.name, fragments);
                this.addFragments(expansion, fragments, quoted);
            } else {
                this.addVariable(expansion, part, quoted);
            }
            return;
        }
        // `?` / `:?`: the shell aborts; we only know the value if it is set.
        if (useDefault) {
            this.addUnknown(expansion, part, quoted, "unset with :?");
        } else {
            this.addVariable(expansion, part, quoted);
        }
    }

    private expandRemoval(
        expansion: WordExpansion,
        part: ParameterExpansionPart,
        operator: string,
        quoted: boolean,
    ): void {
        const state = expansion.scope.env.lookup(part.name);
        const pattern = this.argumentValue(expansion, part);
        if (state.kind !== "set" || pattern === undefined) {
            this.addUnknown(expansion, part, quoted, "pattern removal");
            return;
        }
        const result = removePattern(state.value, pattern, operator);
        if (result === undefined) {
            this.addUnknown(expansion, part, quoted, "pattern removal");
        } else {
            expansion.builder.add(computedFragment(result, part), !quoted);
        }
    }

    private expandSubstitution(
        expansion: WordExpansion,
        part: ParameterExpansionPart,
        operator: string,
        quoted: boolean,
    ): void {
        const state = expansion.scope.env.lookup(part.name);
        const argument = this.argumentValue(expansion, part);
        if (state.kind !== "set" || argument === undefined) {
            this.addUnknown(expansion, part, quoted, "substitution");
            return;
        }
        const slash = argument.indexOf("/");
        if (slash === -1) {
            this.addUnknown(expansion, part, quoted, "substitution");
            return;
        }
        const pattern = argument.slice(0, slash);
        const replacement = argument.slice(slash + 1);
        const result = substitute(state.value, pattern, replacement, operator === "//");
        if (result === undefined) {
            this.addUnknown(expansion, part, quoted, "substitution");
        } else {
            expansion.builder.add(computedFragment(result, part), !quoted);
        }
    }

    private expandSubstring(
        expansion: WordExpansion,
        part: ParameterExpansionPart,
        quoted: boolean,
    ): void {
        const state = expansion.scope.env.lookup(part.name);
        const argument = this.argumentValue(expansion, part);
        if (state.kind !== "set" || argument === undefined) {
            this.addUnknown(expansion, part, quoted, "substring");
            return;
        }
        const result = substring(state.value, argument);
        if (result === undefined) {
            this.addUnknown(expansion, part, quoted, "substring");
        } else {
            expansion.builder.add(computedFragment(result, part), !quoted);
        }
    }

    private expandCase(
        expansion: WordExpansion,
        part: ParameterExpansionPart,
        operator: string,
        quoted: boolean,
    ): void {
        const state = expansion.scope.env.lookup(part.name);
        if (state.kind !== "set") {
            this.addUnknown(expansion, part, quoted, "case conversion");
            return;
        }
        const result = convertCase(
            state.value,
            operator.startsWith("^"),
            operator.length === 2,
        );
        expansion.builder.add(computedFragment(result, part), !quoted);
    }

    private addVariable(
        expansion: WordExpansion,
        part: ParameterExpansionPart,
        quoted: boolean,
    ): void {
        const entry = expansion.scope.env.entry(part.name);
        const state = expansion.scope.env.lookup(part.name);
        if (state.kind === "unknown") {
            this.addUnknown(expansion, part, quoted, "unknown variable");
            return;
        }
        if (state.kind === "unset") {
            if (quoted) {
                expansion.builder.add(computedFragment("", part), false);
            }
            return;
        }
        const binding = entry?.binding;
        expansion.builder.add(
            binding === undefined
                ? computedFragment(state.value, part)
                : bindingFragment(state.value, binding, part),
            !quoted,
        );
    }

    private addArgument(
        expansion: WordExpansion,
        part: ParameterExpansionPart,
        quoted: boolean,
    ): void {
        const fragments = this.argumentFragments(expansion, part);
        this.addFragments(expansion, fragments, quoted);
    }

    private addFragments(
        expansion: WordExpansion,
        fragments: readonly Fragment[],
        quoted: boolean,
    ): void {
        for (const fragment of fragments) {
            expansion.builder.add(fragment, !quoted);
        }
        if (!quoted && fragments.some((fragment) => fragment.text === undefined)) {
            expansion.state.unknownCount = true;
        }
    }

    private addUnknown(
        expansion: WordExpansion,
        node: Node,
        quoted: boolean,
        reason: string,
    ): void {
        expansion.builder.add(unknownFragment(node, reason), !quoted);
        if (!quoted) {
            expansion.state.unknownCount = true;
        }
    }

    private argumentFragments(
        expansion: WordExpansion,
        part: ParameterExpansionPart,
    ): readonly Fragment[] {
        if (part.argument === undefined) {
            return [];
        }
        const sub = new WordExpansion(
            expansion.doc,
            expansion.scope,
            { glob: false, unknownCount: false },
            expansion.embedded,
        );
        this.expandParts(sub, part.argument.parts, false, {});
        const fragments: Fragment[] = [];
        for (const field of sub.builder.fields) {
            for (const desc of field) {
                fragments.push(desc.fragment);
            }
        }
        return fragments;
    }

    private argumentValue(
        expansion: WordExpansion,
        part: ParameterExpansionPart,
    ): string | undefined {
        return fragmentsValue(this.argumentFragments(expansion, part));
    }

    ifsOf(scope: Scope): string | undefined {
        const state = scope.env.lookup("IFS");
        if (state.kind === "unknown") {
            return undefined;
        }
        if (state.kind === "unset") {
            return DEFAULT_IFS;
        }
        return state.value;
    }
}

function containsPositionalAt(parts: readonly WordPart[]): boolean {
    return parts.some(
        (part) => part.kind === "ParameterExpansion" && part.name === "@",
    );
}

function firstIfsChar(expander: WordExpander, scope: Scope): string | undefined {
    const ifs = expander.ifsOf(scope);
    if (ifs === undefined) {
        return undefined;
    }
    return ifs.length === 0 ? "" : ifs[0];
}

function splitField(
    expander: WordExpander,
    expansion: WordExpansion,
    descs: readonly Desc[],
): Fragment[][] {
    if (descs.length === 0) {
        return [];
    }
    const fields: Fragment[][] = [[]];
    const push = (fragment: Fragment): void => {
        (fields[fields.length - 1] as Fragment[]).push(fragment);
    };
    for (const desc of descs) {
        if (!desc.split) {
            push(desc.fragment);
            continue;
        }
        const text = desc.fragment.text;
        const ifs = expander.ifsOf(expansion.scope);
        if (text === undefined || ifs === undefined) {
            expansion.state.unknownCount = true;
            push(desc.fragment);
            continue;
        }
        if (ifs === "") {
            push(desc.fragment);
            continue;
        }
        splitFields(text, ifs).forEach((piece, index) => {
            if (index > 0) {
                fields.push([]);
            }
            if (piece === "") {
                if (index > 0) {
                    push({ text: "", origin: desc.fragment.origin });
                }
            } else {
                push({ text: piece, origin: desc.fragment.origin });
            }
        });
    }
    return fields.filter((field) => field.length > 0);
}

/**
 * Splits on IFS: runs of IFS whitespace are one delimiter and are dropped, a
 * non-whitespace IFS character is its own delimiter (so `a::b` with `IFS=:`
 * yields `a`, ``, `b`).
 */
function splitFields(text: string, ifs: string): string[] {
    const whitespace = new Set<string>(
        [...ifs].filter((c) => c === " " || c === "\t" || c === "\n"),
    );
    const other = new Set<string>([...ifs].filter((c) => !whitespace.has(c)));
    const fields: string[] = [];
    let field = "";
    let index = 0;
    while (index < text.length && whitespace.has(text[index] as string)) {
        index += 1;
    }
    while (index < text.length) {
        const char = text[index] as string;
        if (other.has(char)) {
            fields.push(field);
            field = "";
            index += 1;
            while (index < text.length && whitespace.has(text[index] as string)) {
                index += 1;
            }
            continue;
        }
        if (whitespace.has(char)) {
            if (field !== "") {
                fields.push(field);
                field = "";
            }
            while (index < text.length && whitespace.has(text[index] as string)) {
                index += 1;
            }
            if (index < text.length && other.has(text[index] as string)) {
                fields.push("");
                index += 1;
                while (index < text.length && whitespace.has(text[index] as string)) {
                    index += 1;
                }
            }
            continue;
        }
        field += char;
        index += 1;
    }
    if (field !== "") {
        fields.push(field);
    }
    return fields;
}

function collectUses(args: readonly Arg[], doc: ScriptDocument): readonly PendingUse[] {
    const byPart = new Map<
        ParameterExpansionPart,
        { binding: Binding; indexes: Set<number> }
    >();
    args.forEach((arg, index) => {
        for (const fragment of arg.fragments) {
            if (fragment.origin.kind === "binding") {
                const entry = byPart.get(fragment.origin.part);
                if (entry === undefined) {
                    byPart.set(fragment.origin.part, {
                        binding: fragment.origin.binding,
                        indexes: new Set([index]),
                    });
                } else {
                    entry.indexes.add(index);
                }
            }
        }
    });
    return [...byPart].map(([part, entry]) => ({
        binding: entry.binding,
        part,
        doc,
        indexes: [...entry.indexes],
    }));
}

function collectFragmentUses(
    fragments: readonly Fragment[],
    doc: ScriptDocument,
): readonly PendingUse[] {
    const byPart = new Map<ParameterExpansionPart, Binding>();
    for (const fragment of fragments) {
        if (fragment.origin.kind === "binding") {
            byPart.set(fragment.origin.part, fragment.origin.binding);
        }
    }
    return [...byPart].map(([part, binding]) => ({
        binding,
        part,
        doc,
        indexes: [],
    }));
}

/** Splices out the leading `NAME=` / `NAME+=` characters of an assignment word. */
function prepareAssignmentValue(word: Word): Word {
    const parts = word.parts;
    const first = parts[0];
    if (first === undefined || first.kind !== "Literal") {
        return word;
    }
    const eq = first.value.indexOf("=");
    if (eq === -1) {
        return word;
    }
    const trimmed: WordPart = {
        ...first,
        value: first.value.slice(eq + 1),
        span: { start: first.span.start + eq + 1, end: first.span.end },
    };
    return { ...word, parts: [trimmed, ...parts.slice(1)] };
}

const BRACE_LIMIT = 256;

/** Brace alternatives, spliced in place (prefix, alternative, suffix). */
function braceCombinations(parts: readonly WordPart[], enabled: boolean): WordPart[][] {
    if (!enabled) {
        return [[...parts]];
    }
    const index = parts.findIndex((part) => part.kind === "BraceExpansion");
    if (index === -1) {
        return [[...parts]];
    }
    const brace = parts[index] as BraceExpansionPart;
    const before = parts.slice(0, index);
    const after = parts.slice(index + 1);
    const result: WordPart[][] = [];
    for (const alternative of brace.alternatives) {
        for (const alternativeParts of braceCombinations(alternative.parts, enabled)) {
            for (const tail of braceCombinations(after, enabled)) {
                result.push([...before, ...alternativeParts, ...tail]);
                if (result.length >= BRACE_LIMIT) {
                    return result;
                }
            }
        }
    }
    return result;
}

/** Converts a bash glob pattern into a regular expression. */
export function globToRegExp(pattern: string, anchored: boolean): RegExp {
    let out = anchored ? "^" : "";
    let index = 0;
    while (index < pattern.length) {
        const char = pattern[index] as string;
        if (char === "*") {
            out += ".*";
        } else if (char === "?") {
            out += ".";
        } else if (char === "[") {
            let end = index + 1;
            let cls = "[";
            if (pattern[end] === "!" || pattern[end] === "^") {
                cls += "^";
                end += 1;
            }
            while (end < pattern.length && pattern[end] !== "]") {
                cls += pattern[end];
                end += 1;
            }
            cls += "]";
            out += cls;
            index = end;
        } else {
            out += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        }
        index += 1;
    }
    if (anchored) {
        out += "$";
    }
    try {
        return new RegExp(out);
    } catch {
        return /(?!)/;
    }
}

function removePattern(
    value: string,
    pattern: string,
    operator: string,
): string | undefined {
    const regex = globToRegExp(pattern, true);
    if (operator === "#") {
        for (let i = 0; i <= value.length; i += 1) {
            if (regex.test(value.slice(0, i))) {
                return value.slice(i);
            }
        }
        return value;
    }
    if (operator === "##") {
        for (let i = value.length; i >= 0; i -= 1) {
            if (regex.test(value.slice(0, i))) {
                return value.slice(i);
            }
        }
        return value;
    }
    if (operator === "%") {
        for (let i = 0; i <= value.length; i += 1) {
            if (regex.test(value.slice(value.length - i))) {
                return value.slice(0, value.length - i);
            }
        }
        return value;
    }
    for (let i = value.length; i >= 0; i -= 1) {
        if (regex.test(value.slice(value.length - i))) {
            return value.slice(0, value.length - i);
        }
    }
    return value;
}

function substitute(
    value: string,
    pattern: string,
    replacement: string,
    all: boolean,
): string | undefined {
    if (pattern === "") {
        return undefined;
    }
    const regex = globToRegExp(pattern, false);
    const escaped = replacement.replace(/[$&]/g, (c) => (c === "&" ? "$&" : "$$"));
    try {
        return value.replace(all ? new RegExp(regex.source, "g") : regex, escaped);
    } catch {
        return undefined;
    }
}

function convertCase(value: string, upper: boolean, all: boolean): string {
    if (all) {
        return upper ? value.toUpperCase() : value.toLowerCase();
    }
    if (upper) {
        return value.replace(/^./, (c) => c.toUpperCase());
    }
    return value.replace(/^./, (c) => c.toLowerCase());
}

function substring(value: string, argument: string): string | undefined {
    const parts = argument.split(":");
    const offsetText = (parts[0] ?? "").trim();
    if (!/^-?\d+$/.test(offsetText)) {
        return undefined;
    }
    let offset = Number.parseInt(offsetText, 10);
    if (offset < 0) {
        offset = Math.max(0, value.length + offset);
    }
    if (parts.length === 1) {
        return value.slice(offset);
    }
    const lengthText = (parts[1] ?? "").trim();
    if (lengthText === "") {
        return value.slice(offset);
    }
    if (!/^-?\d+$/.test(lengthText)) {
        return undefined;
    }
    let length = Number.parseInt(lengthText, 10);
    if (length < 0) {
        length = Math.max(0, value.length - offset + length);
    }
    return value.slice(offset, offset + length);
}
