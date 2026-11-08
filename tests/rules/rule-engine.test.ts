import { describe, expect, test } from "bun:test";

import { type EnvironmentView, LOCAL_HOST } from "../../src/interp/context.ts";
import {
    createProjectInspector,
    createScriptInspector,
    MemoryFileSystem,
} from "../../src/project/index.ts";
import type {
    CallArg,
    CommandCall,
    Rule,
    RuleContext,
    RuleScope,
    Verdict,
} from "../../src/rules/rule.ts";
import { RuleEngine, type RuleErrorSink } from "../../src/rules/rule-engine.ts";
import { arg, argsFrom, keep, replace, text } from "../../src/rules/verdict.ts";

function literal(value: string): CallArg {
    return { value, origin: "literal" };
}

function call(...values: (string | undefined)[]): CommandCall {
    const env: EnvironmentView = { lookup: () => ({ kind: "unset" }) };
    return {
        argv: values.map((value) =>
            value === undefined
                ? { value: undefined, origin: "unknown" }
                : literal(value),
        ),
        env,
    };
}

function context(overrides: Partial<RuleContext> = {}): RuleContext {
    const fs = new MemoryFileSystem({});
    return {
        cwd: "/w",
        host: LOCAL_HOST,
        project: createProjectInspector(fs),
        scripts: createScriptInspector(fs),
        files: fs,
        ...overrides,
    };
}

class MapRule implements Rule {
    readonly scope: RuleScope;
    constructor(
        readonly id: string,
        private readonly from: string,
        private readonly to: readonly string[],
    ) {
        this.scope = "local";
    }
    inspect(command: CommandCall): Verdict {
        if (command.argv[0]?.value !== this.from) {
            return keep();
        }
        return replace([...text(...this.to), ...argsFrom(command.argv, 1)], this.id);
    }
}

class AnyScopeRule implements Rule {
    readonly id = "any";
    readonly scope: RuleScope = "any";
    inspect(): Verdict {
        return replace([...text("matched")], "any scope");
    }
}

class ThrowingRule implements Rule {
    readonly id = "boom";
    readonly scope: RuleScope = "local";
    inspect(): Verdict {
        throw new Error("rule exploded");
    }
}

class EnvRule implements Rule {
    readonly id = "env";
    readonly scope: RuleScope = "local";
    constructor(
        private readonly from: string,
        private readonly to: string,
        private readonly env: Readonly<Record<string, string>>,
    ) {}
    inspect(command: CommandCall): Verdict {
        if (command.argv[0]?.value !== this.from) {
            return keep();
        }
        return replace(
            [...text(this.to), ...argsFrom(command.argv, 1)],
            this.id,
            this.env,
        );
    }
}

class ToggleRule implements Rule {
    readonly id = "toggle";
    readonly scope: RuleScope = "local";
    constructor(private readonly extra: boolean) {}
    inspect(command: CommandCall): Verdict {
        const first = command.argv[0]?.value;
        const next = first === "a" ? "b" : "a";
        if (first !== "a" && first !== "b") {
            return keep();
        }
        const argv = this.extra ? [...text(next, "x")] : [...text(next)];
        return replace(argv, this.id);
    }
}

class GrowRule implements Rule {
    readonly id = "grow";
    readonly scope: RuleScope = "local";
    inspect(command: CommandCall): Verdict {
        return replace([...text("y"), ...argsFrom(command.argv, 0)], this.id);
    }
}

class CaptureSink implements RuleErrorSink {
    readonly failures: string[] = [];
    report(failure: { ruleId: string; error: unknown }): void {
        this.failures.push(failure.ruleId);
    }
}

describe("RuleEngine", () => {
    test("first non-keep verdict of a round wins", () => {
        const engine = new RuleEngine([
            new MapRule("first", "a", ["b"]),
            new MapRule("second", "a", ["c"]),
        ]);
        const decision = engine.decide(call("a"), context());
        expect(decision.kind).toBe("replace");
        if (decision.kind !== "replace") {
            return;
        }
        expect(decision.applied.map((entry) => entry.ruleId)).toEqual(["first"]);
    });

    test("composes replacements across rounds in original indices", () => {
        class KeepArgRule implements Rule {
            readonly id = "r1";
            readonly scope: RuleScope = "local";
            inspect(command: CommandCall): Verdict {
                if (command.argv[0]?.value !== "a" || command.argv[1] !== undefined) {
                    return keep();
                }
                return replace([...text("b"), arg(0)], "r1");
            }
        }
        class FinishRule implements Rule {
            readonly id = "r2";
            readonly scope: RuleScope = "local";
            inspect(command: CommandCall): Verdict {
                if (command.argv[0]?.value !== "b" || command.argv[1]?.value !== "a") {
                    return keep();
                }
                return replace([arg(1), ...text("done")], "r2");
            }
        }
        const decision = new RuleEngine([new KeepArgRule(), new FinishRule()]).decide(
            call("a"),
            context(),
        );
        expect(decision.kind).toBe("replace");
        if (decision.kind !== "replace") {
            return;
        }
        // The final argv refers to the *original* index 0 for "a".
        expect(decision.argv).toEqual([
            { kind: "arg", index: 0 },
            { kind: "text", value: "done" },
        ]);
        expect(decision.applied.map((entry) => entry.ruleId)).toEqual(["r1", "r2"]);
    });

    test("accumulates injected environment across rounds", () => {
        const decision = new RuleEngine([
            new EnvRule("a", "b", { A: "1" }),
            new EnvRule("b", "c", { B: "2" }),
        ]).decide(call("a"), context());
        expect(decision.kind).toBe("replace");
        if (decision.kind !== "replace") {
            return;
        }
        expect(decision.env).toEqual({ A: "1", B: "2" });
    });

    test("injected environment overlays the call environment for later rounds", () => {
        const seen: string[] = [];
        class PeekRule implements Rule {
            readonly id = "peek";
            readonly scope: RuleScope = "local";
            inspect(command: CommandCall): Verdict {
                seen.push(JSON.stringify(command.env.lookup("A")));
                if (command.argv[0]?.value !== "b") {
                    return keep();
                }
                return replace([...text("c")], "peek");
            }
        }
        const decision = new RuleEngine([
            new EnvRule("a", "b", { A: "1" }),
            new PeekRule(),
        ]).decide(call("a"), context());
        expect(decision.kind).toBe("replace");
        expect(seen).toContain(JSON.stringify({ kind: "set", value: "1" }));
    });

    test("detects a pure cycle and keeps the original", () => {
        const decision = new RuleEngine([new ToggleRule(false)]).decide(
            call("a"),
            context(),
        );
        expect(decision.kind).toBe("keep");
    });

    test("stops at a repeating argv during a longer cycle", () => {
        const decision = new RuleEngine([new ToggleRule(true)]).decide(
            call("a"),
            context(),
        );
        expect(decision.kind).toBe("replace");
        if (decision.kind !== "replace") {
            return;
        }
        expect(decision.applied).toHaveLength(3);
    });

    test("stops after maxRounds", () => {
        const decision = new RuleEngine([new GrowRule()], { maxRounds: 3 }).decide(
            call("a"),
            context(),
        );
        expect(decision.kind).toBe("replace");
        if (decision.kind !== "replace") {
            return;
        }
        expect(decision.applied).toHaveLength(3);
        expect(decision.argv).toHaveLength(4);
    });

    test("a block in any round wins", () => {
        class BlockRule implements Rule {
            readonly id = "blocker";
            readonly scope: RuleScope = "local";
            inspect(command: CommandCall): Verdict {
                return command.argv[0]?.value === "b"
                    ? { kind: "block", message: "no b" }
                    : keep();
            }
        }
        const decision = new RuleEngine([
            new MapRule("r1", "a", ["b"]),
            new BlockRule(),
        ]).decide(call("a"), context());
        expect(decision).toEqual({ kind: "block", ruleId: "blocker", message: "no b" });
    });

    test("a throwing rule is reported and treated as keep", () => {
        const sink = new CaptureSink();
        const decision = new RuleEngine(
            [new ThrowingRule(), new MapRule("r1", "a", ["b"])],
            {},
            sink,
        ).decide(call("a"), context());
        expect(sink.failures.length).toBeGreaterThan(0);
        expect(new Set(sink.failures)).toEqual(new Set(["boom"]));
        expect(decision.kind).toBe("replace");
    });

    test("scope local rules are skipped on a remote host", () => {
        const contextRemote = context({
            host: { kind: "remote", via: "ssh", target: "x" },
        });
        expect(
            new RuleEngine([new MapRule("r1", "a", ["b"])]).decide(
                call("a"),
                contextRemote,
            ),
        ).toEqual({ kind: "keep" });
        expect(
            new RuleEngine([new AnyScopeRule()]).decide(call("a"), contextRemote),
        ).toMatchObject({ kind: "replace" });
    });

    test("never inspects a call whose argv[0] is unknown", () => {
        const decision = new RuleEngine([new AnyScopeRule()]).decide(
            call(undefined),
            context(),
        );
        expect(decision.kind).toBe("keep");
    });

    test("keeps a replace that resolves to the original values", () => {
        const decision = new RuleEngine([new MapRule("r1", "a", ["a"])]).decide(
            call("a"),
            context(),
        );
        expect(decision.kind).toBe("keep");
    });

    test("keeps when no rule matches", () => {
        expect(new RuleEngine([]).decide(call("a"), context())).toEqual({
            kind: "keep",
        });
    });
});
