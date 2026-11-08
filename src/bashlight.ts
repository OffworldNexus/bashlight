/**
 * The composition root: wires the parser, interpreter, rule engine, rewriter
 * and validator into a `CommandProcessor`. This is the only place that decides
 * which implementations (and which rules) the live pipeline uses.
 */

import { createInterpreter } from "./interp/index.ts";
import type { CommandProcessor } from "./outcome.ts";
import type { FileSystem } from "./project/file-system.ts";
import { createProjectInspector } from "./project/project-inspector.ts";
import { createScriptInspector } from "./project/script-inspector.ts";
import { CommandProcessorImpl } from "./rewrite/processor.ts";
import { Rewriter } from "./rewrite/rewriter.ts";
import { ShellQuoter } from "./rewrite/shell-quoter.ts";
import { createBuiltinRules } from "./rules/builtin/index.ts";
import type { Rule } from "./rules/rule.ts";
import type { RuleErrorSink } from "./rules/rule-engine.ts";

/**
 * The rules in effect for a project directory. The live plugin resolves custom
 * rule files here (project rules depend on the session directory), so the rule
 * set can change without rebuilding the pipeline.
 */
export type RuleProvider = (directory: string) => readonly Rule[];

export interface BashlightOptions {
    readonly fileSystem: FileSystem;
    /** Rule ids to leave out of the engine. Applied after {@link rulesFor}. */
    readonly disabledRules?: readonly string[];
    /** A static rule set, used when {@link rulesFor} is not given. */
    readonly rules?: readonly Rule[];
    /** A dynamic rule set, looked up per project directory. */
    readonly rulesFor?: RuleProvider;
    /** Where rules report unexpected exceptions (fail-open). */
    readonly ruleErrors?: RuleErrorSink;
}

export function createBashlight(options: BashlightOptions): CommandProcessor {
    const interpreter = createInterpreter();
    const disabled = new Set(options.disabledRules ?? []);
    const staticRules = options.rules ?? createBuiltinRules();
    const provider: RuleProvider = options.rulesFor ?? (() => staticRules);
    const rulesFor: RuleProvider = (directory) =>
        provider(directory).filter((rule) => !disabled.has(rule.id));
    const quoter = new ShellQuoter();
    return new CommandProcessorImpl({
        interpreter,
        rulesFor,
        rewriter: new Rewriter(quoter),
        quoter,
        inspectors: () => ({
            project: createProjectInspector(options.fileSystem),
            scripts: createScriptInspector(options.fileSystem),
            files: options.fileSystem,
        }),
        ...(options.ruleErrors === undefined ? {} : { ruleErrors: options.ruleErrors }),
    });
}
