/**
 * Builds the expected shape of the rewritten command for the validator: for
 * every original invocation, the argv/cwd/host it must keep or acquire, the
 * redirections it must not change, the injected variables it must see, and the
 * values of every script-assigned variable it can observe.
 */

import type { Host } from "../interp/context.ts";
import type { EnvironmentView } from "../interp/context.ts";
import type { Interpretation } from "../interp/interpreter.ts";
import type { Invocation, InvocationRedirect } from "../interp/invocation.ts";
import { toArgvIndex } from "./call-builder.ts";
import type { ValueOverride } from "./nested.ts";
import type { RewrittenTarget } from "./rewriter.ts";

export interface ExpectedInvocation {
    readonly kind: Invocation["kind"];
    readonly argv: readonly (string | undefined)[];
    readonly cwd: string | undefined;
    readonly host: Host;
    /** Variables that must be set to this value for the command only. */
    readonly injected: Readonly<Record<string, string>>;
    /** Values the command must see for variables assigned in the script. */
    readonly env: Readonly<Record<string, string | undefined>>;
    /** The redirections, expanded exactly as in the original command. */
    readonly redirects: readonly InvocationRedirect[];
}

export interface ExpectedInput {
    readonly interpretation: Interpretation;
    readonly plan: {
        readonly rewritten: readonly RewrittenTarget[];
        readonly overrides: ReadonlyMap<Invocation, readonly ValueOverride[]>;
        readonly bindingValues: ReadonlyMap<
            string,
            { readonly from: string; readonly to: string }
        >;
    };
    readonly ownerOf: ReadonlyMap<Invocation, number>;
}

export function buildExpected(input: ExpectedInput): ExpectedInvocation[] {
    const rewritten = new Map<number, RewrittenTarget>();
    for (const target of input.plan.rewritten) {
        const index = input.ownerOf.get(target.target.invocation);
        if (index !== undefined) {
            rewritten.set(index, target);
        }
    }
    const scriptNames = scriptAssignedNames(input.interpretation);
    const expected: ExpectedInvocation[] = [];
    for (const invocation of input.interpretation.invocations) {
        const index = input.ownerOf.get(invocation);
        const target = index === undefined ? undefined : rewritten.get(index);
        expected.push({
            kind: invocation.kind,
            argv:
                target === undefined
                    ? withOverrides(invocation, input.plan.overrides.get(invocation))
                    : target.values,
            cwd: invocation.context.cwd,
            host: invocation.context.host,
            injected: target?.env ?? {},
            env: expectedEnv(invocation.env, scriptNames, input.plan.bindingValues),
            redirects: invocation.redirects,
        });
    }
    return expected;
}

function scriptAssignedNames(interpretation: Interpretation): readonly string[] {
    const names = new Set<string>();
    for (const binding of interpretation.bindings) {
        if (binding.assignment !== undefined) {
            names.add(binding.name);
        }
    }
    return [...names];
}

function expectedEnv(
    env: EnvironmentView,
    names: readonly string[],
    folds: ReadonlyMap<string, { readonly from: string; readonly to: string }>,
): Record<string, string | undefined> {
    const values: Record<string, string | undefined> = {};
    for (const name of names) {
        const state = env.lookup(name);
        let value = state.kind === "set" ? state.value : undefined;
        const fold = folds.get(name);
        if (fold !== undefined && value === fold.from) {
            value = fold.to;
        }
        values[name] = value;
    }
    return values;
}

function withOverrides(
    invocation: Invocation,
    overrides: readonly ValueOverride[] | undefined,
): readonly (string | undefined)[] {
    const values = invocation.argv.map((arg) => arg.value);
    if (overrides === undefined) {
        return values;
    }
    const sorted = [...overrides].sort((left, right) => right.start - left.start);
    for (const override of sorted) {
        const start = toArgvIndex(invocation, override.start);
        const end = toArgvIndex(invocation, override.end);
        if (start < 0 || end > values.length || start > end) {
            continue;
        }
        values.splice(start, end - start, ...override.values);
    }
    return values;
}
