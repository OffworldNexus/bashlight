/* eslint-disable sonarjs/function-return-type */
/**
 * One-line fixture builder for the rules tests.
 *
 * `given({ "/w/pyproject.toml": "…" }).at("/w/src").run("pip", "install", "x")`
 * builds the project tree, the command and the context, runs the full engine
 * and returns the resolved outcome. Every replacing run is automatically
 * re-run on its own output to assert idempotence.
 */
import { expect } from "bun:test";

import {
    type EnvironmentView,
    type Host,
    LOCAL_HOST,
    type VariableState,
} from "../../src/interp/context.ts";
import {
    createProjectInspector,
    createScriptInspector,
    MemoryFileSystem,
} from "../../src/project/index.ts";
import { createBuiltinRules } from "../../src/rules/builtin/index.ts";
import type { CallArg, CommandCall, Rule, RuleContext } from "../../src/rules/rule.ts";
import {
    type AppliedRule,
    type Decision,
    RuleEngine,
} from "../../src/rules/rule-engine.ts";
import { ReplacementResolver } from "../../src/rules/verdict.ts";

/** Marks an argument whose value the interpreter cannot know. */
export const UNKNOWN = Symbol("unknown");
export type ArgInput = string | typeof UNKNOWN | CallArg;

/** A fixture tree: absolute POSIX path → file content (or `null` for a dir). */
export type Fixtures = Readonly<Record<string, string | null>>;

/** Result of a run, in terms of the original arguments' resolved values. */
export type Outcome =
    | { readonly kind: "keep" }
    | { readonly kind: "replace"; readonly argv: readonly ArgInput[] }
    | { readonly kind: "block"; readonly message: string };

export const kept: Outcome = { kind: "keep" };

export function blocked(message: string): Outcome {
    return { kind: "block", message };
}

export function rewritten(argv: readonly ArgInput[]): Outcome {
    return { kind: "replace", argv };
}

const REMOTE_HOST: Host = { kind: "remote", via: "ssh", target: "example" };

class MapEnvironment implements EnvironmentView {
    constructor(private readonly vars: Readonly<Record<string, string>>) {}

    lookup(name: string): VariableState {
        return Object.hasOwn(this.vars, name)
            ? { kind: "set", value: this.vars[name] ?? "" }
            : { kind: "unset" };
    }
}

function toCallArg(input: ArgInput): CallArg {
    if (typeof input === "string") {
        return { value: input, origin: "literal" };
    }
    if (input === UNKNOWN) {
        return { value: undefined, origin: "unknown" };
    }
    return input;
}

function toOutcomeArg(value: string | undefined): ArgInput {
    return value === undefined ? UNKNOWN : value;
}

export class Harness {
    private files: Fixtures = {};
    private cwd: string | undefined = "/w";
    private vars: Record<string, string> = {};
    private host: Host = LOCAL_HOST;
    private injectedRules: readonly Rule[] | undefined;
    private rounds: number | undefined;
    private lastApplied: readonly AppliedRule[] = [];

    /** The rules (id + reason) that produced the last `run`'s replacement. */
    get applied(): readonly AppliedRule[] {
        return this.lastApplied;
    }

    given(files: Fixtures): this {
        this.files = files;
        return this;
    }

    at(cwd: string | undefined): this {
        this.cwd = cwd;
        return this;
    }

    env(vars: Readonly<Record<string, string>>): this {
        this.vars = { ...vars };
        return this;
    }

    remote(): this {
        this.host = REMOTE_HOST;
        return this;
    }

    rules(rules: readonly Rule[]): this {
        this.injectedRules = rules;
        return this;
    }

    maxRounds(rounds: number): this {
        this.rounds = rounds;
        return this;
    }

    run(...input: readonly ArgInput[]): Outcome {
        const result = this.decideWith(input);
        this.lastApplied =
            result.decision.kind === "replace" ? result.decision.applied : [];
        const outcome = toOutcome(input, result.decision);
        if (this.injectedRules === undefined && result.decision.kind === "replace") {
            const second = this.decideWith(
                outcome.kind === "replace" ? outcome.argv : [],
            );
            expect(second.decision.kind).toBe("keep");
        }
        return outcome;
    }

    /** The raw engine decision, for composition/cycle/block assertions. */
    decide(...input: readonly ArgInput[]): Decision {
        return this.decideWith(input).decision;
    }

    private decideWith(input: readonly ArgInput[]): {
        decision: Decision;
        call: CommandCall;
    } {
        const argv = input.map(toCallArg);
        const call: CommandCall = {
            argv,
            env: new MapEnvironment(this.vars),
        };
        const fs = new MemoryFileSystem(this.files);
        const context: RuleContext = {
            cwd: this.cwd,
            host: this.host,
            project: createProjectInspector(fs),
            scripts: createScriptInspector(fs),
            files: fs,
        };
        const engine = new RuleEngine(
            this.injectedRules ?? createBuiltinRules(),
            this.rounds === undefined ? {} : { maxRounds: this.rounds },
        );
        return { decision: engine.decide(call, context), call };
    }
}

function toOutcome(input: readonly ArgInput[], decision: Decision): Outcome {
    switch (decision.kind) {
        case "keep":
            return { kind: "keep" };
        case "block":
            return { kind: "block", message: decision.message };
        case "replace": {
            const original = input.map(toCallArg);
            const resolved = new ReplacementResolver(original).resolve(decision.argv);
            return {
                kind: "replace",
                argv: resolved.map((arg) => toOutcomeArg(arg.value)),
            };
        }
    }
}

export function given(files: Fixtures = {}): Harness {
    return new Harness().given(files);
}
