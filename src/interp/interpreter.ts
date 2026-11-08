/**
 * The static pre-interpreter. `Interpreter` is stateless and reusable; every
 * `interpret` call wires a fresh session, expander and walker. It never throws:
 * a parse failure or an internal error yields an empty interpretation.
 */

import { Parser, type ParseResult } from "../syntax/index.ts";
import type { Binding, BindingUse } from "./binding.ts";
import { createBuiltins } from "./builtins/index.ts";
import { BuiltinRegistry } from "./builtins/registry.ts";
import { createScriptDocument, type ScriptDocument } from "./documents.ts";
import { WordExpander } from "./expander.ts";
import type { Invocation } from "./invocation.ts";
import {
    DEFAULT_LIMITS,
    type InitialState,
    type InterpreterLimits,
    InterpretSession,
} from "./session.ts";
import { CommandWalker } from "./walker.ts";
import { createWrappers } from "./wrappers/index.ts";
import { WrapperRegistry } from "./wrappers/registry.ts";

export interface InterpreterDependencies {
    readonly parser: Parser;
    readonly wrappers: WrapperRegistry;
    readonly builtins: BuiltinRegistry;
    readonly limits?: Partial<InterpreterLimits>;
}

export interface Interpretation {
    /** The top-level parse result (nested scripts are parsed separately). */
    readonly parse: ParseResult;
    /** Every command that would execute, in execution order. */
    readonly invocations: readonly Invocation[];
    readonly bindings: readonly Binding[];
    /** Every expansion of every binding, keyed by binding identity. */
    readonly uses: ReadonlyMap<Binding, readonly BindingUse[]>;
    /** Top-level and nested documents. */
    readonly documents: readonly ScriptDocument[];
    /** True when a limit was hit; the rewriter must refuse to rewrite. */
    readonly truncated: boolean;
}

export class Interpreter {
    private readonly parser: Parser;
    private readonly wrappers: WrapperRegistry;
    private readonly builtins: BuiltinRegistry;
    private readonly limits: InterpreterLimits;

    constructor(dependencies: InterpreterDependencies) {
        this.parser = dependencies.parser;
        this.wrappers = dependencies.wrappers;
        this.builtins = dependencies.builtins;
        this.limits = { ...DEFAULT_LIMITS, ...dependencies.limits };
    }

    interpret(source: string, initial: InitialState): Interpretation {
        const doc = createScriptDocument(source);
        const parse = this.parser.parse(doc);
        if (!parse.ok) {
            return emptyInterpretation(parse, doc);
        }
        const session = new InterpretSession({
            wrappers: this.wrappers,
            builtins: this.builtins,
            limits: this.limits,
        });
        const expander = new WordExpander(session);
        const walker = new CommandWalker(session, expander, this.parser);
        session.attach(expander, walker);
        session.pushDocument(doc);
        try {
            walker.runScript(parse.script, doc, session.initialScope(initial));
        } catch {
            return emptyInterpretation(parse, doc);
        }
        return {
            parse,
            invocations: session.invocations,
            bindings: session.bindings,
            uses: session.uses,
            documents: session.documents,
            truncated: session.truncated,
        };
    }
}

function emptyInterpretation(parse: ParseResult, doc: ScriptDocument): Interpretation {
    return {
        parse,
        invocations: [],
        bindings: [],
        uses: new Map(),
        documents: [doc],
        truncated: false,
    };
}

/** The default interpreter: standard parser, wrappers and builtins. */
export function createInterpreter(parser: Parser = new Parser()): Interpreter {
    return new Interpreter({
        parser,
        wrappers: new WrapperRegistry(createWrappers()),
        builtins: new BuiltinRegistry(createBuiltins()),
    });
}
