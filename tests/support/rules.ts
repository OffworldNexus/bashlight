/**
 * Shared test doubles for the custom-rule subsystem, so the catalog, CLI and
 * trust tests build the same fakes and the same stub rules.
 */

import type {
    RuleDirectoryReader,
    RuleFile,
    RuleModuleImporter,
    TrustStorage,
    TrustStore,
} from "../../src/rules/custom/index.ts";
import type { Rule } from "../../src/rules/rule.ts";

/** A rule that always keeps, for provenance/precedence tests. */
export function stubRule(id: string): Rule {
    return { id, scope: "local", inspect: () => ({ kind: "keep" }) };
}

/** A `RuleFile` with a default size, so tests vary only what they assert. */
export function ruleFile(path: string, mtime: number, size = 1): RuleFile {
    return { path, mtime, size };
}

/** A `RuleDirectoryReader` over a fixed path → files map. */
export class MapReader implements RuleDirectoryReader {
    constructor(private readonly byDirectory: Readonly<Record<string, RuleFile[]>>) {}

    entries(directory: string): readonly RuleFile[] {
        return this.byDirectory[directory] ?? [];
    }
}

/** A `RuleModuleImporter` answering from a path → module map, recording calls. */
export class MapImporter implements RuleModuleImporter {
    readonly calls: { readonly path: string; readonly signature: string }[] = [];
    readonly evicted: string[] = [];

    constructor(
        private readonly modules: ReadonlyMap<string, (signature: string) => unknown>,
    ) {}

    import(path: string, signature: string): Promise<unknown> {
        this.calls.push({ path, signature });
        const found = this.modules.get(path);
        return found === undefined
            ? Promise.reject(new Error(`no module for ${path}`))
            : Promise.resolve(found(signature));
    }

    evict(directory: string): void {
        this.evicted.push(directory);
    }
}

/** An importer whose `import` never settles, for timeout tests. */
export class HangingImporter implements RuleModuleImporter {
    import(): Promise<unknown> {
        return new Promise(() => {
            // Never settles.
        });
    }

    evict(): void {
        // Nothing cached.
    }
}

/** A `TrustStore` trusting a fixed set of directories (exact match). */
export class StaticTrust implements TrustStore {
    constructor(private readonly trusted: readonly string[] = []) {}

    isTrusted(directory: string): boolean {
        return this.trusted.includes(directory);
    }

    list(): readonly string[] {
        return this.trusted;
    }
}

/** In-memory `TrustStorage` for `JsonTrustStore` tests. */
export class MemoryTrustStorage implements TrustStorage {
    private text: string | undefined;

    constructor(initial?: string) {
        this.text = initial;
    }

    read(): string | undefined {
        return this.text;
    }

    write(text: string): void {
        this.text = text;
    }
}
