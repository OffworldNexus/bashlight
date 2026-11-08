/**
 * bashlight's public API for rule authors and embedders: the processor factory
 * and the rule contract. Everything a rule file needs at runtime arrives through
 * the `helpers` it is handed; the types here are for authors who type-check.
 */

export {
    type BashlightOptions,
    createBashlight,
    type RuleProvider,
} from "./bashlight.ts";
export type { FileSystem } from "./project/file-system.ts";
export type { RuleFactory, RuleHelpers } from "./rules/custom/index.ts";
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
