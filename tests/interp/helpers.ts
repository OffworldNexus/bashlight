/**
 * Shared helpers for the interpreter tests: run a command and project the
 * invocations into a compact, readable shape.
 */

import type { ScriptDocument } from "../../src/interp/documents.ts";
import {
    createInterpreter,
    type Interpretation,
} from "../../src/interp/interpreter.ts";
import type { Invocation } from "../../src/interp/invocation.ts";
import type { InitialState } from "../../src/interp/session.ts";

export interface RunOptions {
    readonly cwd?: string;
    readonly env?: Readonly<Record<string, string>>;
    readonly complete?: boolean;
}

export function initialState(options: RunOptions = {}): InitialState {
    return {
        cwd: options.cwd,
        variables: options.env ?? {},
        complete: options.complete ?? true,
    };
}

export function interpret(command: string, options: RunOptions = {}): Interpretation {
    return createInterpreter().interpret(command, initialState(options));
}

export interface InvocationView {
    readonly argv: readonly (string | undefined)[];
    readonly kind: string;
    readonly cwd: string | undefined;
    readonly host: string;
    readonly wrappers: readonly string[];
    readonly speculative: boolean;
}

export function hostName(invocation: Invocation): string {
    const host = invocation.context.host;
    if (host.kind === "local") {
        return "local";
    }
    return `remote:${host.via}:${host.target ?? "?"}`;
}

export function view(invocation: Invocation): InvocationView {
    return {
        argv: invocation.argv.map((arg) => arg.value),
        kind: invocation.kind,
        cwd: invocation.context.cwd,
        host: hostName(invocation),
        wrappers: invocation.wrappers.map((wrapper) => wrapper.name),
        speculative: invocation.speculative,
    };
}

export function invocations(
    command: string,
    options: RunOptions = {},
): InvocationView[] {
    return interpret(command, options).invocations.map(view);
}

export function argvs(
    command: string,
    options: RunOptions = {},
): (string | undefined)[][] {
    return invocations(command, options).map((invocation) => [...invocation.argv]);
}

export function topDoc(interpretation: Interpretation): ScriptDocument {
    const doc = interpretation.documents[0];
    if (doc === undefined) {
        throw new Error("no document");
    }
    return doc;
}
