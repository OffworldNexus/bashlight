/** Public surface of the `interp` module. */

export type {
    Binding,
    BindingAssignment,
    BindingSource,
    BindingUse,
    PendingUse,
    UseSite,
} from "./binding.ts";
export { createBuiltins } from "./builtins/index.ts";
export { BuiltinRegistry } from "./builtins/registry.ts";
export type { Builtin, BuiltinInput } from "./builtins/types.ts";
export type {
    EnvironmentView,
    ExecutionContext,
    Host,
    VariableState,
} from "./context.ts";
export { LOCAL_HOST } from "./context.ts";
export type { Nesting, ScriptDocument, ScriptSource } from "./documents.ts";
export {
    createScriptDocument,
    parentDocument,
    prepareScriptSource,
} from "./documents.ts";
export type { Scope, VariableEntry } from "./environment.ts";
export { Environment, executionContext, readString } from "./environment.ts";
export type { ExpandedValue, Expansion } from "./expander.ts";
export { WordExpander } from "./expander.ts";
export type {
    EmbeddedScript,
    ExpansionHost,
    SetValueOptions,
    ShellStdin,
    StdinSource,
    VariableStore,
} from "./interfaces.ts";
export type { Interpretation, InterpreterDependencies } from "./interpreter.ts";
export { createInterpreter, Interpreter } from "./interpreter.ts";
export type { Invocation, WrapperRef } from "./invocation.ts";
export { CommandRunner } from "./runner.ts";
export {
    DEFAULT_LIMITS,
    type InitialState,
    type InterpreterLimits,
    InterpretSession,
    type SessionDependencies,
} from "./session.ts";
export type { Arg, ArgField, Fragment, Origin, Quoting } from "./values.ts";
export { fragmentsValue, literalFragment, soleBinding } from "./values.ts";
export { CommandWalker } from "./walker.ts";
export { createWrappers } from "./wrappers/index.ts";
export { WrapperRegistry } from "./wrappers/registry.ts";
export type {
    EffectiveCommand,
    EffectiveScript,
    UnwrapInput,
    Unwrapped,
    Wrapper,
} from "./wrappers/types.ts";
