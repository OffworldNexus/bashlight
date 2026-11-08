/* eslint-disable sonarjs/function-return-type */
/**
 * The rewriter's safety net: re-interprets the rewritten command and checks
 * that every invocation matches what the plan intended — argv, cwd, host,
 * redirections, injected variables and the values of every script-assigned
 * variable. Any mismatch makes the whole outcome `unchanged`, so an aggressive
 * (or buggy) rewrite can never change a command that would run differently.
 */

import type { Host } from "../interp/context.ts";
import type { Interpretation } from "../interp/interpreter.ts";
import type { Invocation, InvocationRedirect } from "../interp/invocation.ts";
import type { ExpectedInvocation } from "./expected.ts";

export type { ExpectedInvocation } from "./expected.ts";

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
    const argv = compareArgv(wanted, got, index);
    if (argv !== undefined) {
        return argv;
    }
    const redirects = compareRedirects(wanted.redirects, got.redirects, index);
    if (redirects !== undefined) {
        return redirects;
    }
    return compareEnv(wanted, got, index);
}

function compareArgv(
    wanted: ExpectedInvocation,
    got: Invocation,
    index: number,
): string | undefined {
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
    return undefined;
}

function compareRedirects(
    wanted: readonly InvocationRedirect[],
    got: readonly InvocationRedirect[],
    index: number,
): string | undefined {
    if (wanted.length !== got.length) {
        return `invocation ${index}: redirect count changed`;
    }
    for (let position = 0; position < wanted.length; position += 1) {
        const a = wanted[position];
        const b = got[position];
        if (
            a === undefined ||
            b === undefined ||
            a.fd !== b.fd ||
            a.operator !== b.operator ||
            a.target !== b.target ||
            a.heredoc !== b.heredoc
        ) {
            return `invocation ${index}: redirect ${position} changed`;
        }
    }
    return undefined;
}

function compareEnv(
    wanted: ExpectedInvocation,
    got: Invocation,
    index: number,
): string | undefined {
    for (const [name, value] of Object.entries(wanted.injected)) {
        const state = got.env.lookup(name);
        if (state.kind !== "set" || state.value !== value) {
            return `invocation ${index}: env ${name} was not injected`;
        }
    }
    for (const [name, value] of Object.entries(wanted.env)) {
        const state = got.env.lookup(name);
        const actual = state.kind === "set" ? state.value : undefined;
        if (actual !== value) {
            return (
                `invocation ${index}: variable ${name} ` +
                `${format(actual)} != ${format(value)}`
            );
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
