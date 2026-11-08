/** bashlight's public API: the processor factory and the rule contract. */

export {
    type BashlightOptions,
    createBashlight,
    type RuleProvider,
} from "./bashlight.ts";
export type { EnvironmentView, Host, VariableState } from "./interp/context.ts";
export type { Change, CommandProcessor, Outcome, ProcessRequest } from "./outcome.ts";
export {
    createProjectInspector,
    createScriptInspector,
    type FileSystem,
    MemoryFileSystem,
    NodeFileSystem,
    type NodeToolchain,
    type ProjectInspector,
    type PythonToolchain,
    type ScriptInspector,
} from "./project/index.ts";
export { createBuiltinRules } from "./rules/builtin/index.ts";
export {
    type CatalogReport,
    type CatalogRule,
    createRuleHelpers,
    type RuleAccess,
    RuleDirectories,
    type RuleDirectory,
    type RuleFactory,
    type RuleHelpers,
    type RuleLoadError,
    type RuleModuleExport,
    type RuleSource,
} from "./rules/custom/index.ts";
export type {
    ArgOrigin,
    CallArg,
    CommandCall,
    Replacement,
    Rule,
    RuleContext,
    RuleScope,
    Verdict,
} from "./rules/rule.ts";
export {
    arg,
    argsFrom,
    block,
    indexRange,
    keep,
    replace,
    text,
} from "./rules/verdict.ts";
