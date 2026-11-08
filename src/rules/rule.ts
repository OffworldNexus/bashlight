/**
 * The rule extension point: a rule looks at one fully expanded command and
 * decides whether it should run as written, run as something else, or not run.
 *
 * Rules never deal with source text. They describe the new argv in terms of
 * the original arguments (`{ kind: "arg", index }`) and new literal words, and
 * the rewriter figures out how to express that in the original script.
 */
import type { EnvironmentView, Host } from "../interp/context.ts";
import type { ProjectInspector } from "../project/project-inspector.ts";
import type { ScriptInspector } from "../project/script-inspector.ts";

/** Where the value of an argument comes from in the script. */
export type ArgOrigin =
    /** Written literally in the command. */
    | "literal"
    /** Entirely produced by a variable expansion (`$P`). */
    | "variable"
    /** Computed statically (tilde, arithmetic, brace expansion…). */
    | "computed"
    /** Value not statically known (`$(…)`, `$1`…). */
    | "unknown"
    /** A mix of the above inside one word (`"$DIR/x.py"`). */
    | "mixed";

export interface CallArg {
    /** The argument after expansion; undefined when statically unknown. */
    readonly value: string | undefined;
    readonly origin: ArgOrigin;
}

/** One command as it will be executed, after wrappers have been peeled. */
export interface CommandCall {
    /** The effective command; `argv[0].value` is always known. */
    readonly argv: readonly CallArg[];
    /** Variables visible to the command, prefix assignments included. */
    readonly env: EnvironmentView;
}

export interface RuleContext {
    /** Absolute working directory at this exact command, if known. */
    readonly cwd: string | undefined;
    readonly host: Host;
    readonly project: ProjectInspector;
    /** Reads the shebang of script files (`./manage.py`, `bin/cli`…). */
    readonly scripts: ScriptInspector;
}

/** One word of a replacement argv. */
export type Replacement =
    /** Reuse the original argument at this index (keeps its origin). */
    | { readonly kind: "arg"; readonly index: number }
    /** A new word with this exact value (the rewriter quotes it). */
    | { readonly kind: "text"; readonly value: string };

export type Verdict =
    | { readonly kind: "keep" }
    | {
          readonly kind: "replace";
          readonly argv: readonly Replacement[];
          /** Extra environment variables for this command only. */
          readonly env?: Readonly<Record<string, string>>;
          /** Human-readable explanation, for the audit log. */
          readonly reason: string;
      }
    | {
          readonly kind: "block";
          /** Shown to the agent instead of running the command. */
          readonly message: string;
      };

/** Which hosts a rule applies to. Built-in rules only make sense locally. */
export type RuleScope = "local" | "any";

export interface Rule {
    /** Stable identifier, used in configuration and audit logs. */
    readonly id: string;
    readonly scope: RuleScope;
    inspect(call: CommandCall, context: RuleContext): Verdict;
}
