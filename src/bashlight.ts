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
import { RuleEngine } from "./rules/rule-engine.ts";

export interface BashlightOptions {
    readonly fileSystem: FileSystem;
    /** Rule ids to leave out of the engine. */
    readonly disabledRules?: readonly string[];
    /** Overrides the built-in rule set (tests, experiments). */
    readonly rules?: readonly Rule[];
}

export function createBashlight(options: BashlightOptions): CommandProcessor {
    const interpreter = createInterpreter();
    const available = options.rules ?? createBuiltinRules();
    const disabled = new Set(options.disabledRules ?? []);
    const rules = available.filter((rule) => !disabled.has(rule.id));
    const quoter = new ShellQuoter();
    return new CommandProcessorImpl({
        interpreter,
        engine: new RuleEngine(rules),
        rewriter: new Rewriter(quoter),
        quoter,
        inspectors: () => ({
            project: createProjectInspector(options.fileSystem),
            scripts: createScriptInspector(options.fileSystem),
        }),
    });
}
