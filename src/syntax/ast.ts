/**
 * The bash AST. Every node is a readonly discriminated union member keyed by
 * `kind` and carries an exact `span` into the source document. Nodes are
 * deliberately plain data: no methods, no back-references, safe to serialise.
 *
 * `Word.value` (and each part's `value`) is the *decoded* text after quote
 * removal; `span` is always the *raw* source range, so the rewriter can edit the
 * exact characters the user typed.
 */

import type { ParseError } from "./errors.ts";
import type { Span } from "./source.ts";

export interface Script {
    readonly kind: "Script";
    readonly body: CommandList;
    /** Spans of `# …` comments, in source order. */
    readonly comments: readonly Span[];
    readonly span: Span;
}

/** Command separators that can terminate a list item. */
export type Separator = ";" | "&" | "\n";

export interface CommandListItem {
    readonly kind: "CommandListItem";
    readonly command: AndOr;
    /** The separator that followed the command, `undefined` at end of list. */
    readonly separator: Separator | undefined;
    readonly span: Span;
}

export interface CommandList {
    readonly kind: "CommandList";
    readonly items: readonly CommandListItem[];
    readonly span: Span;
}

export interface AndOrLink {
    readonly kind: "AndOrLink";
    readonly operator: "&&" | "||";
    readonly pipeline: Pipeline;
    readonly span: Span;
}

export interface AndOr {
    readonly kind: "AndOr";
    readonly first: Pipeline;
    readonly rest: readonly AndOrLink[];
    readonly span: Span;
}

export interface TimeKeyword {
    readonly kind: "TimeKeyword";
    /** `time -p`. */
    readonly posix: boolean;
    readonly span: Span;
}

export interface PipelineMember {
    readonly kind: "PipelineMember";
    readonly command: Command;
    /** `|`, `|&`, or `undefined` for the last member. */
    readonly pipe: "|" | "|&" | undefined;
    readonly span: Span;
}

export interface Pipeline {
    readonly kind: "Pipeline";
    readonly negated: boolean;
    readonly time: TimeKeyword | undefined;
    readonly members: readonly PipelineMember[];
    readonly span: Span;
}

export type Command =
    | SimpleCommand
    | Subshell
    | BraceGroup
    | If
    | For
    | Select
    | While
    | Until
    | Case
    | FunctionDefinition
    | ArithmeticCommand
    | TestCommand
    | Coproc;

export interface SimpleCommand {
    readonly kind: "SimpleCommand";
    /** All elements in the order they appear (redirects may sit between words). */
    readonly elements: readonly (Assignment | Word | Redirect)[];
    readonly words: readonly Word[];
    /** Leading `A=1` assignments (only before the command name). */
    readonly assignments: readonly Assignment[];
    readonly redirects: readonly Redirect[];
    readonly span: Span;
}

export interface Subshell {
    readonly kind: "Subshell";
    readonly body: CommandList;
    readonly redirects: readonly Redirect[];
    readonly span: Span;
}

export interface BraceGroup {
    readonly kind: "BraceGroup";
    readonly body: CommandList;
    readonly redirects: readonly Redirect[];
    readonly span: Span;
}

export interface IfClause {
    readonly kind: "IfClause";
    readonly condition: CommandList;
    readonly body: CommandList;
    readonly span: Span;
}

export interface If {
    readonly kind: "If";
    /** The `if` clause first, then each `elif` clause. */
    readonly clauses: readonly IfClause[];
    readonly elseBody: CommandList | undefined;
    readonly redirects: readonly Redirect[];
    readonly span: Span;
}

export interface ArithmeticHeader {
    readonly kind: "ArithmeticHeader";
    readonly init: string;
    readonly condition: string;
    readonly update: string;
    readonly span: Span;
}

export interface ForHeader {
    readonly kind: "ForHeader";
    readonly name: string | undefined;
    readonly nameSpan: Span | undefined;
    /** `for (( init; cond; update ))`. */
    readonly arithmetic: ArithmeticHeader | undefined;
    /** The `in …` words; empty when `in` is omitted. */
    readonly items: readonly Word[];
    readonly span: Span;
}

export interface For {
    readonly kind: "For";
    readonly header: ForHeader;
    readonly body: CommandList;
    readonly redirects: readonly Redirect[];
    readonly span: Span;
}

export interface Select {
    readonly kind: "Select";
    readonly header: ForHeader;
    readonly body: CommandList;
    readonly redirects: readonly Redirect[];
    readonly span: Span;
}

export interface While {
    readonly kind: "While";
    readonly condition: CommandList;
    readonly body: CommandList;
    readonly redirects: readonly Redirect[];
    readonly span: Span;
}

export interface Until {
    readonly kind: "Until";
    readonly condition: CommandList;
    readonly body: CommandList;
    readonly redirects: readonly Redirect[];
    readonly span: Span;
}

export type CaseTerminator = ";;" | ";&" | ";;&";

export interface CaseItem {
    readonly kind: "CaseItem";
    readonly patterns: readonly Word[];
    readonly body: CommandList;
    readonly terminator: CaseTerminator | undefined;
    readonly span: Span;
}

export interface Case {
    readonly kind: "Case";
    readonly word: Word;
    readonly items: readonly CaseItem[];
    readonly redirects: readonly Redirect[];
    readonly span: Span;
}

export interface FunctionDefinition {
    readonly kind: "FunctionDefinition";
    readonly name: string;
    readonly nameSpan: Span;
    /** True for the `function f {…}` form, false for `f() {…}`. */
    readonly functionKeyword: boolean;
    readonly body: Command;
    readonly span: Span;
}

export interface ArithmeticCommand {
    readonly kind: "ArithmeticCommand";
    /** Raw arithmetic text between `((` and `))`. */
    readonly expression: string;
    readonly redirects: readonly Redirect[];
    readonly span: Span;
}

export type TestOperatorKind =
    "&&" | "||" | "!" | "(" | ")" | "<" | ">" | "==" | "!=" | "=~" | "=";

export interface TestOperator {
    readonly kind: "TestOperator";
    readonly operator: TestOperatorKind;
    readonly span: Span;
}

export interface TestCommand {
    readonly kind: "TestCommand";
    readonly elements: readonly (Word | TestOperator)[];
    readonly words: readonly Word[];
    readonly redirects: readonly Redirect[];
    readonly span: Span;
}

export interface Coproc {
    readonly kind: "Coproc";
    readonly name: string | undefined;
    readonly nameSpan: Span | undefined;
    readonly body: Command | undefined;
    readonly span: Span;
}

export interface Assignment {
    readonly kind: "Assignment";
    readonly name: string;
    /** `a[i]=x` subscript, parsed as a word (raw arithmetic-ish text). */
    readonly index: Word | undefined;
    /** `a+=x`. */
    readonly append: boolean;
    readonly value: Word | ArrayValue;
    readonly span: Span;
    readonly nameSpan: Span;
    readonly valueSpan: Span;
}

export interface ArrayValue {
    readonly kind: "ArrayValue";
    readonly elements: readonly Word[];
    readonly span: Span;
}

export type RedirectOperator =
    ">" | ">>" | "<" | "<<" | "<<-" | "<<<" | "<>" | ">|" | "&>" | "&>>" | "<&" | ">&";

/** The redirection's file descriptor: `2`, `{var}`, or the default. */
export type RedirectFd =
    | { readonly kind: "number"; readonly fd: number }
    | { readonly kind: "var"; readonly name: string }
    | undefined;

export interface Redirect {
    readonly kind: "Redirect";
    readonly fd: RedirectFd;
    readonly operator: RedirectOperator;
    readonly target: Word | HereDoc;
    readonly span: Span;
}

export interface HereDoc {
    readonly kind: "HereDoc";
    /** The delimiter with quotes removed. */
    readonly delimiter: string;
    /** Whether the delimiter was quoted (⇒ no expansion in the body). */
    readonly quoted: boolean;
    /** `<<-`. */
    readonly stripTabs: boolean;
    /** Whether the closing delimiter was found (false ⇒ EOF-delimited). */
    readonly terminated: boolean;
    /** Body parsed like a double-quoted string, or a single literal. */
    readonly body: Word;
    /** Raw body range (between the operator line and the delimiter line/EOF). */
    readonly bodySpan: Span;
    readonly span: Span;
}

export interface Word {
    readonly kind: "Word";
    readonly parts: readonly WordPart[];
    /** Decoded value, `undefined` when it depends on something unknown. */
    readonly value: string | undefined;
    readonly span: Span;
}

export type WordPart =
    | LiteralPart
    | SingleQuotedPart
    | DoubleQuotedPart
    | AnsiCQuotedPart
    | LocaleQuotedPart
    | ParameterExpansionPart
    | CommandSubstitutionPart
    | ArithmeticExpansionPart
    | ProcessSubstitutionPart
    | TildePart
    | BraceExpansionPart;

/** Unquoted text; `value` is the text after backslash removal. */
export interface LiteralPart {
    readonly kind: "Literal";
    readonly value: string;
    /** Whether it contains unquoted glob characters (`*`, `?`, `[`). */
    readonly hasGlob: boolean;
    readonly span: Span;
}

export interface SingleQuotedPart {
    readonly kind: "SingleQuoted";
    readonly value: string;
    readonly span: Span;
}

/** `"…"`; `$"…"` produces a `LocaleQuotedPart` with the same shape. */
export interface DoubleQuotedPart {
    readonly kind: "DoubleQuoted";
    readonly parts: readonly WordPart[];
    readonly value: string | undefined;
    readonly span: Span;
}

/** `$'…'` with the escapes decoded. */
export interface AnsiCQuotedPart {
    readonly kind: "AnsiCQuoted";
    readonly value: string;
    readonly span: Span;
}

/** `$"…"`; behaves like double quotes (locale translation is ignored). */
export interface LocaleQuotedPart {
    readonly kind: "LocaleQuoted";
    readonly parts: readonly WordPart[];
    readonly value: string | undefined;
    readonly span: Span;
}

export interface ParameterExpansionPart {
    readonly kind: "ParameterExpansion";
    /** Parameter name: `x`, `1`, `@`, `#`, `?`, … */
    readonly name: string;
    /** `$x` (simple) versus `${x}` (braced). */
    readonly simple: boolean;
    /** `${a[i]}` subscript. */
    readonly index: Word | undefined;
    /** `${x:-…}`, `${x#…}`, `${x/a/b}`, `${x@Q}` … */
    readonly operator: string | undefined;
    /** The operator's operand word. */
    readonly argument: Word | undefined;
    /** `${#x}`. */
    readonly length: boolean;
    /** `${!x}`. */
    readonly indirect: boolean;
    readonly span: Span;
}

export interface CommandSubstitutionPart {
    readonly kind: "CommandSubstitution";
    readonly script: Script;
    readonly style: "dollar" | "backtick";
    readonly span: Span;
}

export interface ArithmeticExpansionPart {
    readonly kind: "ArithmeticExpansion";
    /** Raw arithmetic text (`$(( … ))` / `$[ … ]`). */
    readonly expression: string;
    readonly span: Span;
}

export interface ProcessSubstitutionPart {
    readonly kind: "ProcessSubstitution";
    readonly direction: "<" | ">";
    readonly script: Script;
    readonly span: Span;
}

export interface TildePart {
    readonly kind: "Tilde";
    /** The user/host after `~`, when present. */
    readonly user: string | undefined;
    readonly value: string;
    readonly span: Span;
}

export interface BraceExpansionPart {
    readonly kind: "BraceExpansion";
    /**
     * The alternatives, as words: `{a,b}` → `a`, `b`; `{1..3}` → `1`, `3`.
     */
    readonly alternatives: readonly Word[];
    /** Whether this is a `{x..y}` sequence rather than a `,` list. */
    readonly sequence: boolean;
    readonly span: Span;
}

export type Node =
    | Script
    | CommandList
    | CommandListItem
    | AndOr
    | AndOrLink
    | Pipeline
    | TimeKeyword
    | PipelineMember
    | Command
    | SimpleCommand
    | Subshell
    | BraceGroup
    | If
    | IfClause
    | For
    | ForHeader
    | Select
    | While
    | Until
    | Case
    | CaseItem
    | FunctionDefinition
    | ArithmeticCommand
    | TestCommand
    | TestOperator
    | Coproc
    | Assignment
    | ArrayValue
    | Redirect
    | HereDoc
    | Word
    | WordPart;

export type ParseResult =
    | { readonly ok: true; readonly script: Script }
    | { readonly ok: false; readonly error: ParseError };
