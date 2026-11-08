import { describe, expect, test } from "bun:test";

import {
    createRuleHelpers,
    RuleCatalog,
    RuleDirectories,
    type RuleDirectoryReader,
    type RuleFile,
    type RuleModuleImporter,
    RuleModuleLoader,
} from "../../src/rules/custom/index.ts";
import type { Rule } from "../../src/rules/rule.ts";

function ruleOf(id: string): Rule {
    return { id, scope: "local", inspect: () => ({ kind: "keep" }) };
}

/** A `RuleDirectoryReader` over a fixed path → files map. */
class MapReader implements RuleDirectoryReader {
    constructor(private readonly byDirectory: Readonly<Record<string, RuleFile[]>>) {}

    entries(directory: string): readonly RuleFile[] {
        return this.byDirectory[directory] ?? [];
    }
}

/** A `RuleModuleImporter` answering from a path → factory map. */
class MapImporter implements RuleModuleImporter {
    readonly calls: { readonly path: string; readonly version: number }[] = [];

    constructor(
        private readonly modules: ReadonlyMap<string, (version: number) => unknown>,
    ) {}

    import(path: string, version: number): Promise<unknown> {
        this.calls.push({ path, version });
        const found = this.modules.get(path);
        if (found === undefined) {
            return Promise.reject(new Error(`no module for ${path}`));
        }
        return Promise.resolve(found(version));
    }
}

/** A loader over the given modules, with the production helpers. */
function loaderFor(modules: ReadonlyMap<string, (version: number) => unknown>) {
    return new RuleModuleLoader({
        importer: new MapImporter(modules),
        helpers: createRuleHelpers(),
    });
}

function moduleOf(value: unknown): (version: number) => unknown {
    return () => ({ default: value });
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
        const loader = loaderFor(new Map([["a.ts", moduleOf(ruleOf("a"))]]));
        const loaded = await loader.load("a.ts", 1);
        expect(loaded.ok).toBe(true);
        if (loaded.ok) {
            expect(loaded.rules.map((rule) => rule.id)).toEqual(["a"]);
        }
    });

    test("calls a factory with the helpers", async () => {
        let received = false;
        const factory = (helpers: { keep: unknown }): Rule => {
            received = typeof helpers.keep === "function";
            return ruleOf("from-factory");
        };
        const loader = loaderFor(new Map([["a.ts", moduleOf(factory)]]));
        const loaded = await loader.load("a.ts", 1);
        expect(received).toBe(true);
        expect(loaded.ok).toBe(true);
    });

    test("flattens arrays of rules and factories", async () => {
        const value = [ruleOf("a"), () => [ruleOf("b"), ruleOf("c")]];
        const loader = loaderFor(new Map([["a.ts", moduleOf(value)]]));
        const loaded = await loader.load("a.ts", 1);
        expect(loaded.ok).toBe(true);
        if (loaded.ok) {
            expect(loaded.rules.map((rule) => rule.id)).toEqual(["a", "b", "c"]);
        }
    });

    test("reports a missing default export", async () => {
        const loader = loaderFor(new Map([["a.ts", () => ({})]]));
        expect(await loader.load("a.ts", 1)).toEqual({
            ok: false,
            message: "module has no default export",
        });
    });

    test("reports a default export that is neither a rule nor a factory", async () => {
        const loader = loaderFor(new Map([["a.ts", moduleOf(42)]]));
        const loaded = await loader.load("a.ts", 1);
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
        const loaded = await loader.load("a.ts", 1);
        expect(loaded.ok).toBe(false);
        if (!loaded.ok) {
            expect(loaded.message).toContain("bad factory");
        }
    });

    test("catches an importer that throws", async () => {
        const loader = loaderFor(new Map());
        const loaded = await loader.load("missing.ts", 1);
        expect(loaded.ok).toBe(false);
        if (!loaded.ok) {
            expect(loaded.message).toContain("could not import");
        }
    });

    test("rejects an object that only looks like a rule", async () => {
        const loader = loaderFor(
            new Map([["a.ts", moduleOf({ id: "a", scope: "local" })]]),
        );
        const loaded = await loader.load("a.ts", 1);
        expect(loaded.ok).toBe(false);
    });
});

interface CatalogSetup {
    readonly reader: MapReader;
    readonly importer: MapImporter;
    readonly catalog: RuleCatalog;
    readonly reported: string[];
}

function catalog(
    modules: ReadonlyMap<string, (version: number) => unknown>,
    files: Readonly<Record<string, RuleFile[]>>,
    options: {
        readonly disabledRules?: readonly string[];
        readonly builtins?: readonly Rule[];
    } = {},
): CatalogSetup {
    const reported: string[] = [];
    const importer = new MapImporter(modules);
    const catalog = new RuleCatalog({
        directories: new RuleDirectories("/home/u/.config/opencode"),
        reader: new MapReader(files),
        loader: new RuleModuleLoader({
            importer,
            helpers: createRuleHelpers(),
        }),
        reporter: { error: (message) => reported.push(message) },
        disabledRules: options.disabledRules ?? [],
        builtins: () => [...(options.builtins ?? [ruleOf("builtin")])],
    });
    return {
        reader: new MapReader(files),
        importer,
        catalog,
        reported,
    };
}

const PROJECT = "/w/.opencode/bashlight/rules";

describe("RuleCatalog", () => {
    test("falls back to the built-ins before anything is prepared", () => {
        const setup = catalog(new Map(), {}, { builtins: [ruleOf("builtin")] });
        expect(setup.catalog.rulesFor("/w").map((rule) => rule.id)).toEqual([
            "builtin",
        ]);
    });

    test("puts project rules before the built-ins", async () => {
        const setup = catalog(
            new Map([
                ["/w/.opencode/bashlight/rules/a.ts", moduleOf(ruleOf("custom"))],
            ]),
            { [PROJECT]: [{ path: `${PROJECT}/a.ts`, mtime: 1 }] },
            { builtins: [ruleOf("builtin")] },
        );
        await setup.catalog.prepare("/w");
        expect(setup.catalog.rulesFor("/w").map((rule) => rule.id)).toEqual([
            "custom",
            "builtin",
        ]);
        expect(setup.catalog.report("/w").rules[0]?.source).toBe("project");
    });

    test("a custom rule with a built-in id replaces it", async () => {
        const setup = catalog(
            new Map([
                [
                    "/w/.opencode/bashlight/rules/a.ts",
                    moduleOf(ruleOf("python-runner")),
                ],
            ]),
            { [PROJECT]: [{ path: `${PROJECT}/a.ts`, mtime: 1 }] },
            { builtins: [ruleOf("python-runner"), ruleOf("node-manager")] },
        );
        await setup.catalog.prepare("/w");
        const report = setup.catalog.report("/w");
        expect(report.rules.map((rule) => rule.id)).toEqual([
            "python-runner",
            "node-manager",
        ]);
        expect(report.rules[0]?.source).toBe("project");
    });

    test("disabled rules are dropped from both sources", async () => {
        const setup = catalog(
            new Map([
                ["/w/.opencode/bashlight/rules/a.ts", moduleOf(ruleOf("custom"))],
            ]),
            { [PROJECT]: [{ path: `${PROJECT}/a.ts`, mtime: 1 }] },
            { builtins: [ruleOf("builtin")], disabledRules: ["custom", "builtin"] },
        );
        await setup.catalog.prepare("/w");
        expect(setup.catalog.rulesFor("/w")).toEqual([]);
        expect(setup.catalog.report("/w").rules.every((rule) => rule.disabled)).toBe(
            true,
        );
    });

    test("caches by mtime and busts the import cache on change", async () => {
        const files: Record<string, RuleFile[]> = {
            [PROJECT]: [{ path: `${PROJECT}/a.ts`, mtime: 1 }],
        };
        const modules = new Map<string, (version: number) => unknown>([
            [`${PROJECT}/a.ts`, moduleOf(ruleOf("v1"))],
        ]);
        const importer = new MapImporter(modules);
        const catalog = new RuleCatalog({
            directories: new RuleDirectories("/home/u/.config/opencode"),
            reader: new MapReader(files),
            loader: new RuleModuleLoader({
                importer,
                helpers: createRuleHelpers(),
            }),
            builtins: () => [],
        });
        await catalog.prepare("/w");
        await catalog.prepare("/w");
        expect(importer.calls).toHaveLength(1);
        expect(importer.calls[0]?.version).toBe(1);

        // The file changed: a new mtime and a new module must be picked up.
        files[PROJECT] = [{ path: `${PROJECT}/a.ts`, mtime: 2 }];
        modules.set(`${PROJECT}/a.ts`, moduleOf(ruleOf("v2")));
        await catalog.prepare("/w");
        expect(importer.calls).toHaveLength(2);
        expect(importer.calls[1]?.version).toBe(2);
        expect(catalog.rulesFor("/w").map((rule) => rule.id)).toEqual(["v2"]);
    });

    test("reports a load error once per (file, mtime)", async () => {
        const setup = catalog(
            new Map(), // no module: the import fails
            { [PROJECT]: [{ path: `${PROJECT}/bad.ts`, mtime: 1 }] },
        );
        await setup.catalog.prepare("/w");
        await setup.catalog.prepare("/w");
        expect(setup.reported).toHaveLength(1);
        expect(setup.catalog.report("/w").errors).toHaveLength(1);
    });

    test("keeps the built-ins when a custom file is broken", async () => {
        const setup = catalog(
            new Map(),
            { [PROJECT]: [{ path: `${PROJECT}/bad.ts`, mtime: 1 }] },
            { builtins: [ruleOf("builtin")] },
        );
        await setup.catalog.prepare("/w");
        expect(setup.catalog.rulesFor("/w").map((rule) => rule.id)).toEqual([
            "builtin",
        ]);
    });
});
