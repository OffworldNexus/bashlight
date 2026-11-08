/* eslint-disable sonarjs/function-return-type */
/**
 * The rewriter's safety net: re-interprets the rewritten command and checks
 * that every invocation matches what the plan intended. Any mismatch makes the
 * whole outcome `unchanged`, so an aggressive (or buggy) rewrite can never
 * change a command that would run differently.
 */

import type { Host } from "../interp/context.ts";
import type { Interpretation } from "../interp/interpreter.ts";
import type { Invocation } from "../interp/invocation.ts";

/** What one invocation of the rewritten command must look like. */
export interface ExpectedInvocation {
    readonly kind: Invocation["kind"];
    readonly argv: readonly (string | undefined)[];
    readonly cwd: string | undefined;
    readonly host: Host;
    /** Variables that must be set to this value for the command only. */
    readonly env: Readonly<Record<string, string>>;
}

export type ValidationResult =
    { readonly ok: true } | { readonly ok: false; readonly reason: string };

export function validate(
    rewritten: Interpretation,
    expected: readonly ExpectedInvocation[],
): ValidationResult {
    const actual = rewritten.invocations;
    if (actual.length !== expected.length) {
        return fail(`invocation count ${actual.length} != expected ${expected.length}`);
    }
    for (let index = 0; index < expected.length; index += 1) {
        const wanted = expected[index];
        const got = actual[index];
        const mismatch =
            wanted === undefined || got === undefined
                ? "missing invocation"
                : compare(wanted, got, index);
        if (mismatch !== undefined) {
            return fail(mismatch);
        }
    }
    return { ok: true };
}

function compare(
    wanted: ExpectedInvocation,
    got: Invocation,
    index: number,
): string | undefined {
    if (wanted.kind !== got.kind) {
        return `invocation ${index}: kind ${got.kind} != ${wanted.kind}`;
    }
    if (wanted.cwd !== got.context.cwd) {
        return `invocation ${index}: cwd ${got.context.cwd} != ${wanted.cwd}`;
    }
    if (hostKey(wanted.host) !== hostKey(got.context.host)) {
        return `invocation ${index}: host changed`;
    }
    const values = got.argv.map((arg) => arg.value);
    if (values.length !== wanted.argv.length) {
        return `invocation ${index}: argv length ${values.length} != ${wanted.argv.length}`;
    }
    for (let position = 0; position < values.length; position += 1) {
        if (values[position] !== wanted.argv[position]) {
            return (
                `invocation ${index}: argv[${position}] ` +
                `${format(values[position])} != ${format(wanted.argv[position])}`
            );
        }
    }
    for (const [name, value] of Object.entries(wanted.env)) {
        const state = got.env.lookup(name);
        if (state.kind !== "set" || state.value !== value) {
            return `invocation ${index}: env ${name} was not injected`;
        }
    }
    return undefined;
}

function hostKey(host: Host): string {
    return host.kind === "local" ? "local" : `remote:${host.via}:${host.target ?? "?"}`;
}

function format(value: string | undefined): string {
    return value === undefined ? "<unknown>" : JSON.stringify(value);
}

function fail(reason: string): ValidationResult {
    return { ok: false, reason };
}
