import { describe, expect, test } from "bun:test";

import { PromiseRuleDeadline } from "../../src/opencode/rule-deadline.ts";
import {
    createRuleHelpers,
    RuleCatalog,
    RuleDirectories,
    type RuleFile,
    RuleModuleLoader,
} from "../../src/rules/custom/index.ts";
import type { Rule } from "../../src/rules/rule.ts";
import {
    HangingImporter,
    MapImporter,
    MapReader,
    ruleFile,
    StaticTrust,
    stubRule,
} from "../support/rules.ts";

/** A module whose default export is `value`. */
function moduleOf(value: unknown): (signature: string) => unknown {
    return () => ({ default: value });
}

/** A loader over the given modules, with the production helpers. */
function loaderFor(
    modules: ReadonlyMap<string, (signature: string) => unknown>,
    options: { readonly timeoutMs?: number; readonly deadline?: never } = {},
) {
    return new RuleModuleLoader({
        importer: new MapImporter(modules),
        helpers: createRuleHelpers(),
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    });
}

describe("RuleDirectories", () => {
    test("lists the project folder, then the global one", () => {
        const directories = new RuleDirectories("/home/u/.config/opencode");
        expect(directories.all("/w/project")).toEqual([
            { origin: "project", path: "/w/project/.opencode/bashlight/rules" },
            { origin: "global", path: "/home/u/.config/opencode/bashlight/rules" },
        ]);
    });
});

describe("RuleModuleLoader", () => {
    test("accepts a plain rule object", async () => {
        const loader = loaderFor(new Map([["a.ts", moduleOf(stubRule("a"))]]));
        const loaded = await loader.load("a.ts", "sig");
        expect(loaded.ok).toBe(true);
        if (loaded.ok) {
            expect(loaded.rules.map((rule) => rule.id)).toEqual(["a"]);
        }
    });

    test("calls a factory with the helpers", async () => {
        let received = false;
        const factory = (helpers: { keep: unknown }): Rule => {
            received = typeof helpers.keep === "function";
            return stubRule("from-factory");
        };
        const loader = loaderFor(new Map([["a.ts", moduleOf(factory)]]));
        const loaded = await loader.load("a.ts", "sig");
        expect(received).toBe(true);
        expect(loaded.ok).toBe(true);
    });

    test("flattens arrays of rules and factories", async () => {
        const value = [stubRule("a"), () => [stubRule("b"), stubRule("c")]];
        const loader = loaderFor(new Map([["a.ts", moduleOf(value)]]));
        const loaded = await loader.load("a.ts", "sig");
        expect(loaded.ok).toBe(true);
        if (loaded.ok) {
            expect(loaded.rules.map((rule) => rule.id)).toEqual(["a", "b", "c"]);
        }
    });

    test("reports a missing default export", async () => {
        const loader = loaderFor(new Map([["a.ts", () => ({})]]));
        expect(await loader.load("a.ts", "sig")).toEqual({
            ok: false,
            message: "module has no default export",
        });
    });

    test("reports a default export that is neither a rule nor a factory", async () => {
        const loader = loaderFor(new Map([["a.ts", moduleOf(42)]]));
        const loaded = await loader.load("a.ts", "sig");
        expect(loaded.ok).toBe(false);
    });

    test("catches a factory that throws", async () => {
        const loader = loaderFor(
            new Map([
                [
                    "a.ts",
                    moduleOf(() => {
                        throw new Error("bad factory");
                    }),
                ],
            ]),
        );
        const loaded = await loader.load("a.ts", "sig");
        expect(loaded.ok).toBe(false);
        if (!loaded.ok) {
            expect(loaded.message).toContain("bad factory");
        }
    });

    test("catches an importer that throws", async () => {
        const loader = loaderFor(new Map());
        const loaded = await loader.load("missing.ts", "sig");
        expect(loaded.ok).toBe(false);
        if (!loaded.ok) {
            expect(loaded.message).toContain("could not import");
        }
    });

    test("rejects an object that only looks like a rule", async () => {
        const loader = loaderFor(
            new Map([["a.ts", moduleOf({ id: "a", scope: "local" })]]),
        );
        const loaded = await loader.load("a.ts", "sig");
        expect(loaded.ok).toBe(false);
    });

    test("survives a hostile proxy as the default export", async () => {
        const hostile = new Proxy(
            {},
            {
                get() {
                    throw new Error("boom");
                },
            },
        );
        const loader = loaderFor(new Map([["a.ts", moduleOf(hostile)]]));
        const loaded = await loader.load("a.ts", "sig");
        expect(loaded.ok).toBe(false);
        if (!loaded.ok) {
            expect(loaded.message).toContain("boom");
        }
    });

    test("survives a hostile module namespace", async () => {
        const namespace = new Proxy(
            {},
            {
                has() {
                    throw new Error("no has");
                },
                get() {
                    throw new Error("no get");
                },
            },
        );
        const loader = loaderFor(new Map([["a.ts", () => namespace]]));
        const loaded = await loader.load("a.ts", "sig");
        expect(loaded.ok).toBe(false);
    });

    test("rejects a self-referential array instead of recursing forever", async () => {
        const cyclic: unknown[] = [];
        cyclic.push(cyclic);
        const loader = loaderFor(new Map([["a.ts", moduleOf(cyclic)]]));
        const loaded = await loader.load("a.ts", "sig");
        expect(loaded.ok).toBe(false);
        if (!loaded.ok) {
            expect(loaded.message).toContain("cycle");
        }
    });

    test("times out a slow import instead of hanging", async () => {
        const loader = new RuleModuleLoader({
            importer: new HangingImporter(),
            helpers: createRuleHelpers(),
            deadline: new PromiseRuleDeadline(),
            timeoutMs: 10,
        });
        const loaded = await loader.load("a.ts", "sig");
        expect(loaded.ok).toBe(false);
        if (!loaded.ok) {
            expect(loaded.message).toContain("timed out");
        }
    });

    test("evicts a directory through the injected importer", () => {
        const importer = new MapImporter(new Map());
        new RuleModuleLoader({
            importer,
            helpers: createRuleHelpers(),
        }).evict("/w/.opencode/bashlight/rules");
        expect(importer.evicted).toEqual(["/w/.opencode/bashlight/rules"]);
    });
});

interface CatalogSetup {
    readonly importer: MapImporter;
    readonly catalog: RuleCatalog;
    readonly reported: string[];
}

const PROJECT = "/w/.opencode/bashlight/rules";
const GLOBAL = "/home/u/.config/opencode/bashlight/rules";

function catalog(
    modules: ReadonlyMap<string, (signature: string) => unknown>,
    files: Readonly<Record<string, RuleFile[]>>,
    options: {
        readonly disabledRules?: readonly string[];
        readonly builtins?: readonly Rule[];
        readonly trust?: readonly string[];
        readonly customRules?: boolean;
        readonly maxCachedDirectories?: number;
    } = {},
): CatalogSetup {
    const reported: string[] = [];
    const importer = new MapImporter(modules);
    const catalog = new RuleCatalog({
        directories: new RuleDirectories("/home/u/.config/opencode"),
        reader: new MapReader(files),
        loader: new RuleModuleLoader({ importer, helpers: createRuleHelpers() }),
        trust: new StaticTrust(options.trust ?? ["/w"]),
        reporter: { error: (message) => reported.push(message) },
        disabledRules: options.disabledRules ?? [],
        builtins: () => [...(options.builtins ?? [stubRule("builtin")])],
        ...(options.customRules === undefined
            ? {}
            : { customRules: options.customRules }),
        ...(options.maxCachedDirectories === undefined
            ? {}
            : { maxCachedDirectories: options.maxCachedDirectories }),
    });
    return { importer, catalog, reported };
}

describe("RuleCatalog", () => {
    test("falls back to the built-ins before anything is refreshed", () => {
        const setup = catalog(new Map(), {}, { builtins: [stubRule("builtin")] });
        expect(setup.catalog.rulesFor("/w").map((rule) => rule.id)).toEqual([
            "builtin",
        ]);
        expect(setup.catalog.report("/w").customRulesEnabled).toBe(true);
    });

    test("puts trusted project rules before the built-ins", async () => {
        const setup = catalog(
            new Map([[`${PROJECT}/a.ts`, moduleOf(stubRule("custom"))]]),
            { [PROJECT]: [ruleFile(`${PROJECT}/a.ts`, 1)] },
            { builtins: [stubRule("builtin")] },
        );
        await setup.catalog.refresh("/w");
        expect(setup.catalog.rulesFor("/w").map((rule) => rule.id)).toEqual([
            "custom",
            "builtin",
        ]);
        expect(setup.catalog.report("/w").rules[0]?.source).toBe("project");
    });

    test("ignores project rules until the project is trusted", async () => {
        const setup = catalog(
            new Map([[`${PROJECT}/a.ts`, moduleOf(stubRule("custom"))]]),
            { [PROJECT]: [ruleFile(`${PROJECT}/a.ts`, 1)] },
            { builtins: [stubRule("builtin")], trust: [] },
        );
        await setup.catalog.refresh("/w");
        expect(setup.catalog.rulesFor("/w").map((rule) => rule.id)).toEqual([
            "builtin",
        ]);
        expect(setup.catalog.report("/w").untrusted).toEqual({
            directory: "/w",
            files: 1,
        });
        await setup.catalog.refresh("/w");
        expect(
            setup.reported.filter((message) => message.includes("not trusted")),
        ).toHaveLength(1);
    });

    test("customRules: false drops every custom rule", async () => {
        const setup = catalog(
            new Map([
                [`${PROJECT}/a.ts`, moduleOf(stubRule("custom"))],
                [`${GLOBAL}/g.ts`, moduleOf(stubRule("global"))],
            ]),
            {
                [PROJECT]: [ruleFile(`${PROJECT}/a.ts`, 1)],
                [GLOBAL]: [ruleFile(`${GLOBAL}/g.ts`, 1)],
            },
            { builtins: [stubRule("builtin")], customRules: false },
        );
        await setup.catalog.refresh("/w");
        const report = setup.catalog.report("/w");
        expect(report.customRulesEnabled).toBe(false);
        expect(report.untrusted).toBeUndefined();
        expect(report.rules.map((rule) => rule.id)).toEqual(["builtin"]);
        expect(setup.importer.calls).toHaveLength(0);
    });

    test("a custom rule with a built-in id replaces it", async () => {
        const setup = catalog(
            new Map([[`${PROJECT}/a.ts`, moduleOf(stubRule("python-runner"))]]),
            { [PROJECT]: [ruleFile(`${PROJECT}/a.ts`, 1)] },
            { builtins: [stubRule("python-runner"), stubRule("node-manager")] },
        );
        await setup.catalog.refresh("/w");
        const report = setup.catalog.report("/w");
        expect(report.rules.map((rule) => rule.id)).toEqual([
            "python-runner",
            "node-manager",
        ]);
        expect(report.rules[0]?.source).toBe("project");
    });

    test("disabled rules are dropped from both sources", async () => {
        const setup = catalog(
            new Map([[`${PROJECT}/a.ts`, moduleOf(stubRule("custom"))]]),
            { [PROJECT]: [ruleFile(`${PROJECT}/a.ts`, 1)] },
            { builtins: [stubRule("builtin")], disabledRules: ["custom", "builtin"] },
        );
        await setup.catalog.refresh("/w");
        expect(setup.catalog.rulesFor("/w")).toEqual([]);
        expect(setup.catalog.report("/w").rules.every((rule) => rule.disabled)).toBe(
            true,
        );
    });

    test("caches an unchanged directory and reloads all on any change", async () => {
        const files: Record<string, RuleFile[]> = {
            [PROJECT]: [ruleFile(`${PROJECT}/a.ts`, 1), ruleFile(`${PROJECT}/b.ts`, 1)],
        };
        const modules = new Map<string, (signature: string) => unknown>([
            [`${PROJECT}/a.ts`, moduleOf(stubRule("a"))],
            [`${PROJECT}/b.ts`, moduleOf(stubRule("b"))],
        ]);
        const setup = catalog(modules, files, {
            builtins: [],
        });
        await setup.catalog.refresh("/w");
        await setup.catalog.refresh("/w");
        expect(setup.importer.calls).toHaveLength(2);

        // One file changes: the whole directory reloads and is evicted first.
        files[PROJECT] = [
            ruleFile(`${PROJECT}/a.ts`, 2, 99),
            ruleFile(`${PROJECT}/b.ts`, 1),
        ];
        await setup.catalog.refresh("/w");
        expect(setup.importer.calls).toHaveLength(4);
        expect(setup.importer.evicted.filter((dir) => dir === PROJECT)).toHaveLength(2);
        expect(setup.catalog.rulesFor("/w").map((rule) => rule.id)).toEqual(["a", "b"]);
    });

    test("reloads when a file appears or disappears", async () => {
        const files: Record<string, RuleFile[]> = {
            [PROJECT]: [ruleFile(`${PROJECT}/a.ts`, 1)],
        };
        const modules = new Map<string, (signature: string) => unknown>([
            [`${PROJECT}/a.ts`, moduleOf(stubRule("a"))],
        ]);
        const setup = catalog(modules, files, { builtins: [] });
        await setup.catalog.refresh("/w");
        expect(setup.catalog.rulesFor("/w").map((rule) => rule.id)).toEqual(["a"]);

        files[PROJECT] = [];
        await setup.catalog.refresh("/w");
        expect(setup.catalog.rulesFor("/w")).toEqual([]);

        files[PROJECT] = [ruleFile(`${PROJECT}/c.ts`, 5)];
        modules.set(`${PROJECT}/c.ts`, moduleOf(stubRule("c")));
        await setup.catalog.refresh("/w");
        expect(setup.catalog.rulesFor("/w").map((rule) => rule.id)).toEqual(["c"]);
    });

    test("concurrent refreshes of one directory share a single load", async () => {
        const modules = new Map<string, (signature: string) => unknown>([
            [`${PROJECT}/a.ts`, moduleOf(stubRule("a"))],
        ]);
        const setup = catalog(modules, {
            [PROJECT]: [ruleFile(`${PROJECT}/a.ts`, 1)],
        });
        await Promise.all([setup.catalog.refresh("/w"), setup.catalog.refresh("/w")]);
        expect(setup.importer.calls).toHaveLength(1);
    });

    test("bounds the directory cache (LRU)", async () => {
        const modules = new Map<string, (signature: string) => unknown>([
            [`/w1/.opencode/bashlight/rules/a.ts`, moduleOf(stubRule("a"))],
            [`/w2/.opencode/bashlight/rules/b.ts`, moduleOf(stubRule("b"))],
        ]);
        const files = {
            "/w1/.opencode/bashlight/rules": [
                ruleFile(`/w1/.opencode/bashlight/rules/a.ts`, 1),
            ],
            "/w2/.opencode/bashlight/rules": [
                ruleFile(`/w2/.opencode/bashlight/rules/b.ts`, 1),
            ],
        };
        const setup = catalog(modules, files, {
            trust: ["/w1", "/w2"],
            maxCachedDirectories: 1,
        });
        await setup.catalog.refresh("/w1");
        await setup.catalog.refresh("/w2");
        const before = setup.importer.calls.length;
        await setup.catalog.refresh("/w1");
        // /w1 was evicted, so its rule file is imported again.
        expect(setup.importer.calls.length).toBeGreaterThan(before);
    });

    test("reports a load error once per file revision", async () => {
        const setup = catalog(
            new Map(), // no module: the import fails
            { [PROJECT]: [ruleFile(`${PROJECT}/bad.ts`, 1)] },
        );
        await setup.catalog.refresh("/w");
        await setup.catalog.refresh("/w");
        expect(
            setup.reported.filter((message) => message.includes("could not load")),
        ).toHaveLength(1);
        expect(setup.catalog.report("/w").errors).toHaveLength(1);
    });

    test("keeps the built-ins when a custom file is broken", async () => {
        const setup = catalog(
            new Map(),
            {
                [PROJECT]: [ruleFile(`${PROJECT}/bad.ts`, 1)],
            },
            { builtins: [stubRule("builtin")] },
        );
        await setup.catalog.refresh("/w");
        expect(setup.catalog.rulesFor("/w").map((rule) => rule.id)).toEqual([
            "builtin",
        ]);
    });
});
