// Walking a bash AST is inherently branchy (one case per command kind).
/* eslint-disable sonarjs/function-return-type */
/**
 * The AST walk: command lists, `&&`/`||` chains, pipelines, compounds,
 * redirections and heredocs, nested scripts, and function-body speculation.
 * Simple commands are handed to the `CommandRunner`.
 */

import type {
    AndOr,
    Case,
    Command,
    CommandList,
    For,
    HereDoc,
    If,
    Parser,
    Pipeline,
    Redirect,
    Script,
    Select,
    TestCommand,
    Until,
    While,
} from "../syntax/index.ts";
import {
    createScriptDocument,
    prepareScriptSource,
    type ScriptDocument,
    type ScriptSource,
} from "./documents.ts";
import { type Environment, forkScope, type Scope } from "./environment.ts";
import type { WordExpander } from "./expander.ts";
import type { ShellStdin, StdinSource } from "./interfaces.ts";
import type { Invocation, InvocationRedirect } from "./invocation.ts";
import { CommandRunner } from "./runner.ts";
import type { InterpretSession } from "./session.ts";

export class CommandWalker {
    readonly runner: CommandRunner;
    private inheritedStdin: string | undefined;

    constructor(
        private readonly session: InterpretSession,
        private readonly expander: WordExpander,
        private readonly parser: Parser,
    ) {
        this.runner = new CommandRunner(session, expander, this);
    }

    runScript(script: Script, doc: ScriptDocument, scope: Scope): void {
        this.runList(script.body, doc, scope);
        this.runSpeculativeFunctions(doc, scope);
    }

    runList(list: CommandList, doc: ScriptDocument, scope: Scope): void {
        for (const item of list.items) {
            if (item.separator === "&") {
                this.runAndOr(item.command, doc, forkScope(scope));
            } else {
                this.runAndOr(item.command, doc, scope);
            }
        }
    }

    /**
     * `&&`/`||` chains. We walk the *success path* sequentially (we assume every
     * command on it succeeds, so `cd x` really moves), then merge the state of
     * every other way out of the chain:
     *
     * - an `&&` link can exit because the pipeline on its immediate left failed
     *   (its effects did not happen), so that earlier state is a branch;
     * - a `||` link can exit after its left side succeeded (RHS skipped) or
     *   after its left side failed (RHS run in a fork);
     * - a failure exit whose RHS unconditionally terminates is dropped, since
     *   the shell would have exited.
     */
    runAndOr(andOr: AndOr, doc: ScriptDocument, scope: Scope): void {
        let beforeLast = scope.env.fork();
        this.runPipeline(andOr.first, doc, scope);
        let afterLast = scope.env;
        const exits: Environment[] = [];
        for (const link of andOr.rest) {
            if (link.operator === "&&") {
                exits.push(beforeLast);
                beforeLast = afterLast;
                this.runPipeline(link.pipeline, doc, scope);
                afterLast = scope.env;
            } else {
                exits.push(afterLast);
                const fork = forkScope(scope);
                this.runPipeline(link.pipeline, doc, fork);
                if (!pipelineTerminates(link.pipeline)) {
                    exits.push(fork.env);
                }
            }
        }
        if (exits.length > 0) {
            scope.env.mergeFrom([scope.env.fork(), ...exits]);
        }
    }

    runPipeline(pipeline: Pipeline, doc: ScriptDocument, scope: Scope): void {
        if (pipeline.members.length <= 1) {
            const member = pipeline.members[0];
            if (member !== undefined) {
                this.runCommand(member.command, doc, scope);
            }
            return;
        }
        for (const member of pipeline.members) {
            this.runCommand(member.command, doc, forkScope(scope));
        }
    }

    runCommand(command: Command, doc: ScriptDocument, scope: Scope): void {
        switch (command.kind) {
            case "SimpleCommand":
                this.runner.runSimpleCommand(command, doc, scope);
                return;
            case "Subshell":
                this.expandRedirects(command.redirects, doc, scope);
                this.runList(command.body, doc, forkScope(scope));
                return;
            case "BraceGroup":
                this.expandRedirects(command.redirects, doc, scope);
                this.runList(command.body, doc, scope);
                return;
            case "If":
                this.expandRedirects(command.redirects, doc, scope);
                this.runIf(command, doc, scope);
                return;
            case "For":
            case "Select":
                this.expandRedirects(command.redirects, doc, scope);
                this.runFor(command, doc, scope);
                return;
            case "While":
            case "Until":
                this.expandRedirects(command.redirects, doc, scope);
                this.runWhile(command, doc, scope);
                return;
            case "Case":
                this.expandRedirects(command.redirects, doc, scope);
                this.runCase(command, doc, scope);
                return;
            case "FunctionDefinition":
                scope.env.functions.set(command.name, command);
                return;
            case "ArithmeticCommand":
                this.expandRedirects(command.redirects, doc, scope);
                this.recordArithmeticReads(command.expression, command, doc, scope);
                return;
            case "TestCommand":
                this.expandRedirects(command.redirects, doc, scope);
                this.expandTestCommand(command, doc, scope);
                return;
            case "Coproc":
                if (command.body !== undefined) {
                    this.runCommand(command.body, doc, forkScope(scope));
                }
                return;
        }
    }

    private runIf(command: If, doc: ScriptDocument, scope: Scope): void {
        const branches: Environment[] = [];
        for (const clause of command.clauses) {
            this.runList(clause.condition, doc, scope);
            const branch = forkScope(scope);
            this.runList(clause.body, doc, branch);
            branches.push(branch.env);
        }
        if (command.elseBody !== undefined) {
            const branch = forkScope(scope);
            this.runList(command.elseBody, doc, branch);
            branches.push(branch.env);
        } else {
            branches.push(scope.env.fork());
        }
        scope.env.mergeFrom(branches);
    }

    private runFor(command: For | Select, doc: ScriptDocument, scope: Scope): void {
        const header = command.header;
        let values: string[] | undefined = [];
        for (const item of header.items) {
            const expansion = this.expander.expandWord(item, doc, scope);
            this.session.recordUses(expansion.uses, { kind: "other" });
            this.runEmbeddedJobs(expansion.embedded, scope);
            for (const arg of expansion.args) {
                if (arg.value === undefined) {
                    values = undefined;
                } else if (values !== undefined) {
                    values.push(arg.value);
                }
            }
        }
        if (header.items.length === 0 && header.arithmetic === undefined) {
            values = undefined;
        }
        const name = header.name;
        if (name !== undefined) {
            if (values !== undefined && values.length === 1) {
                this.session.setString(scope, name, values[0] as string, {
                    assignment: { kind: "synthetic" },
                });
            } else {
                this.session.setUnknown(scope, name);
            }
        }
        this.runIteration(command.body, doc, scope);
    }

    private runWhile(command: While | Until, doc: ScriptDocument, scope: Scope): void {
        this.runList(command.condition, doc, scope);
        this.runIteration(command.body, doc, scope);
    }

    /** Runs a loop body once and merges it with the state where it might not. */
    private runIteration(body: CommandList, doc: ScriptDocument, scope: Scope): void {
        const before = scope.env.fork();
        const iteration = forkScope(scope);
        this.runList(body, doc, iteration);
        scope.env.mergeFrom([iteration.env, before]);
    }

    private runCase(command: Case, doc: ScriptDocument, scope: Scope): void {
        const expanded = this.expander.expandValue(command.word, doc, scope);
        this.session.recordUses(expanded.uses, { kind: "other" });
        this.runEmbeddedJobs(expanded.embedded, scope);
        const branches: Environment[] = [];
        for (const item of command.items) {
            for (const pattern of item.patterns) {
                const patternExpansion = this.expander.expandValue(pattern, doc, scope);
                this.session.recordUses(patternExpansion.uses, { kind: "other" });
                this.runEmbeddedJobs(patternExpansion.embedded, scope);
            }
            const branch = forkScope(scope);
            this.runList(item.body, doc, branch);
            branches.push(branch.env);
        }
        branches.push(scope.env.fork());
        scope.env.mergeFrom(branches);
    }

    private expandTestCommand(
        command: TestCommand,
        doc: ScriptDocument,
        scope: Scope,
    ): void {
        for (const word of command.words) {
            const expanded = this.expander.expandValue(word, doc, scope);
            this.session.recordUses(expanded.uses, { kind: "other" });
            this.runEmbeddedJobs(expanded.embedded, scope);
        }
    }

    // --- redirections and stdin ---------------------------------------------

    /**
     * Expands every redirection exactly once and returns the command's own
     * stdin heredoc/herestring (so a heredoc feeding a shell is never expanded
     * twice) plus the expanded redirections for the validator.
     */
    expandRedirects(
        redirects: readonly Redirect[],
        doc: ScriptDocument,
        scope: Scope,
    ): { stdin: ShellStdin | undefined; redirects: InvocationRedirect[] } {
        let stdin: ShellStdin | undefined;
        const expandedRedirects: InvocationRedirect[] = [];
        for (const redirect of redirects) {
            if (redirect.operator === "<<" || redirect.operator === "<<-") {
                const here = redirect.target as HereDoc;
                if (here.kind === "HereDoc") {
                    const source = this.expandHeredoc(here, redirect, doc, scope);
                    expandedRedirects.push({
                        fd: redirectFd(redirect),
                        operator: redirect.operator,
                        target: undefined,
                        heredoc: source?.text,
                    });
                    if (redirectIsStdin(redirect)) {
                        stdin ??= source;
                    }
                    continue;
                }
            }
            const expanded = this.expander.expandValue(
                redirect.target as Exclude<typeof redirect.target, HereDoc>,
                doc,
                scope,
            );
            this.session.recordUses(expanded.uses, { kind: "redirect" });
            this.runEmbeddedJobs(expanded.embedded, scope);
            expandedRedirects.push({
                fd: redirectFd(redirect),
                operator: redirect.operator,
                target: expanded.value,
                heredoc: undefined,
            });
            if (
                redirect.operator === "<<<" &&
                redirectIsStdin(redirect) &&
                expanded.value !== undefined
            ) {
                stdin ??= {
                    text: expanded.value,
                    span: (redirect.target as { span: { start: number; end: number } })
                        .span,
                    redirect,
                };
            }
        }
        return { stdin, redirects: expandedRedirects };
    }

    private expandHeredoc(
        here: HereDoc,
        redirect: Redirect,
        doc: ScriptDocument,
        scope: Scope,
    ): ShellStdin | undefined {
        if (here.quoted) {
            return {
                text: here.body.value ?? "",
                span: here.bodySpan,
                redirect,
            };
        }
        const expanded = this.expander.expandValue(here.body, doc, scope);
        this.session.recordUses(expanded.uses, { kind: "redirect" });
        this.runEmbeddedJobs(expanded.embedded, scope);
        if (expanded.value === undefined) {
            return undefined;
        }
        return { text: expanded.value, span: here.bodySpan, redirect };
    }

    /** Records the names `(( … ))` reads, so the rewriter never folds them. */
    private recordArithmeticReads(
        expression: string,
        node: Command,
        doc: ScriptDocument,
        scope: Scope,
    ): void {
        for (const name of new Set(expression.match(ARITHMETIC_NAME) ?? [])) {
            const binding = scope.env.entry(name)?.binding;
            if (binding !== undefined) {
                this.session.recordUses([{ binding, part: node, doc, indexes: [] }], {
                    kind: "other",
                });
            }
        }
    }

    /** A `StdinSource` for one command: its own heredoc, else the inherited one. */
    makeStdin(own: ShellStdin | undefined): StdinSource {
        return {
            text: (): string | undefined => own?.text ?? this.takeInheritedStdin(),
            shellStdin: (): ShellStdin | undefined => {
                if (own !== undefined) {
                    return own;
                }
                const inherited = this.takeInheritedStdin();
                return inherited === undefined
                    ? undefined
                    : {
                          text: inherited,
                          span: { start: 0, end: 0 },
                          redirect: undefined,
                      };
            },
        };
    }

    private takeInheritedStdin(): string | undefined {
        const value = this.inheritedStdin;
        this.inheritedStdin = undefined;
        return value;
    }

    // --- nested scripts -----------------------------------------------------

    /** Runs a `$(…)`/`<(…)` script in a discarded fork of `scope`. */
    runEmbedded(script: Script, doc: ScriptDocument, scope: Scope): void {
        if (!this.session.enterNesting()) {
            return;
        }
        try {
            this.runList(script.body, doc, forkScope(scope));
        } finally {
            this.session.leaveNesting();
        }
    }

    runEmbeddedJobs(
        jobs: readonly { readonly script: Script; readonly doc: ScriptDocument }[],
        scope: Scope,
    ): void {
        for (const job of jobs) {
            this.runEmbedded(job.script, job.doc, scope);
        }
    }

    /** Parses and runs a script read from an argument or a heredoc. */
    runScriptSource(
        source: ScriptSource,
        invocation: Invocation,
        scope: Scope,
        stdinText: string | undefined,
    ): void {
        const prepared = prepareScriptSource(source, invocation);
        if (prepared === undefined) {
            return;
        }
        const nestedDoc = createScriptDocument(prepared.text, {
            parent: prepared.parent,
            nesting: prepared.nesting,
        });
        this.session.pushDocument(nestedDoc);
        if (!this.session.enterNesting()) {
            return;
        }
        try {
            const parse = this.parser.parse(nestedDoc);
            if (!parse.ok) {
                return;
            }
            const savedStdin = this.inheritedStdin;
            this.inheritedStdin = stdinText ?? savedStdin;
            try {
                this.runList(parse.script.body, nestedDoc, scope);
            } finally {
                this.inheritedStdin = savedStdin;
            }
        } finally {
            this.session.leaveNesting();
        }
    }

    // --- speculative function bodies ----------------------------------------

    private runSpeculativeFunctions(doc: ScriptDocument, scope: Scope): void {
        const done = new Set<string>();
        let changed = true;
        while (changed) {
            changed = false;
            for (const [name, fn] of scope.env.functions) {
                if (this.session.wasCalled(name) || done.has(name)) {
                    continue;
                }
                done.add(name);
                changed = true;
                const saved = scope.env.positionals;
                scope.env.positionals = undefined;
                this.session.setSpeculative(true);
                try {
                    this.runCommand(fn.body, doc, scope);
                } finally {
                    this.session.setSpeculative(false);
                    scope.env.positionals = saved;
                }
            }
        }
    }
}

/** Variable names inside an arithmetic expression. */
const ARITHMETIC_NAME = /[A-Za-z_]\w*/g;

/** A heredoc/herestring is on stdin when its fd is 0 or unspecified. */
export function redirectIsStdin(redirect: Redirect): boolean {
    const fd = redirect.fd;
    return fd === undefined || (fd.kind === "number" && fd.fd === 0);
}

/** The redirect's file descriptor as a stable string (`""` for the default). */
function redirectFd(redirect: Redirect): string {
    const fd = redirect.fd;
    if (fd === undefined) {
        return "";
    }
    return fd.kind === "number" ? String(fd.fd) : `{${fd.name}}`;
}

function pipelineTerminates(pipeline: Pipeline): boolean {
    const last = pipeline.members[pipeline.members.length - 1];
    return last !== undefined && commandTerminates(last.command);
}

function commandTerminates(command: Command): boolean {
    if (command.kind === "SimpleCommand") {
        const first = command.words[0]?.value;
        return first === "exit" || first === "return";
    }
    if (command.kind === "BraceGroup" || command.kind === "Subshell") {
        const last = command.body.items[command.body.items.length - 1];
        if (last === undefined) {
            return false;
        }
        const andOr = last.command;
        const pipeline =
            andOr.rest.length > 0
                ? (andOr.rest[andOr.rest.length - 1]?.pipeline as Pipeline)
                : andOr.first;
        return pipelineTerminates(pipeline);
    }
    return false;
}
