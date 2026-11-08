/** Public surface of the `rewrite` module. */

export type { Alignment, Gap } from "./alignment.ts";
export { align, gapIndex } from "./alignment.ts";
export {
    bindingWords,
    type EditableValue,
    editableValue,
    renderValue,
    splitSafe,
    type ValueStyle,
} from "./binding-edit.ts";
export { classifyArg, isSubmitted, toCommandCall } from "./call-builder.ts";
export {
    CommandProcessorImpl,
    type Inspectors,
    type ProcessorDependencies,
} from "./processor.ts";
export {
    type GivenUpTarget,
    type PlanInput,
    type PlanResult,
    Rewriter,
    type RewriteTarget,
    type RewrittenTarget,
} from "./rewriter.ts";
export { type QuoteContext, ShellQuoter } from "./shell-quoter.ts";
export { applyEdits, type TextEdit } from "./text-edit.ts";
export {
    type ExpectedInvocation,
    validate,
    type ValidationResult,
} from "./validator.ts";
export {
    type GapPlan,
    planGap,
    planInline,
    planRegenerate,
    planWordLevel,
    type WordLevelPlan,
} from "./word-level.ts";
