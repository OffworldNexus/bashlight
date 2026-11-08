import { join } from "../shared/posix-path.ts";
import type { FileSystem } from "./file-system.ts";
import { isObject, type JsonObject, parseJsonObject } from "./json.ts";
import { BIN_DIR, NODE_MODULES, PACKAGE_JSON } from "./manifests.ts";
import type { NodeManager, NodeToolchain } from "./toolchain.ts";

const DEPENDENCY_FIELDS = [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
] as const;

/** One package.json location and its parsed content (undefined when unreadable). */
interface PackageContext {
    readonly dir: string;
    readonly pkg: JsonObject | undefined;
}

/** npm package names are lowercase, so dependency names are case-folded. */
export function normalizeNodeName(name: string): string {
    return name.trim().toLowerCase();
}

/** Concrete Node toolchain; reads the package.json files lazily and caches. */
export class NodeToolchainImpl implements NodeToolchain {
    readonly ecosystem = "node";

    private packagesCache: readonly PackageContext[] | undefined;
    private declarationCache: ReadonlySet<string> | undefined;
    private scriptCache: ReadonlySet<string> | undefined;

    constructor(
        private readonly fs: FileSystem,
        readonly manager: NodeManager,
        readonly managerVersion: string | undefined,
        readonly yarnBerry: boolean,
        readonly root: string,
        readonly workspaceRoot: string,
    ) {}

    declares(pkg: string): boolean {
        const normalized = normalizeNodeName(pkg);
        if (normalized === "") {
            return false;
        }
        return this.declarations().has(normalized) || this.hasBinary(pkg);
    }

    hasScript(name: string): boolean {
        this.scriptCache ??= this.collectScripts();
        return this.scriptCache.has(name);
    }

    /**
     * Declaration names are case-folded; the `node_modules/.bin` lookup keeps
     * the caller's spelling because bin names are case-sensitive on disk.
     */
    private hasBinary(name: string): boolean {
        for (const { dir } of this.packages()) {
            if (this.fs.exists(join(dir, NODE_MODULES, BIN_DIR, name))) {
                return true;
            }
        }
        return false;
    }

    private declarations(): ReadonlySet<string> {
        this.declarationCache ??= this.collectDeclarations();
        return this.declarationCache;
    }

    private collectDeclarations(): ReadonlySet<string> {
        const names = new Set<string>();
        for (const { pkg } of this.packages()) {
            for (const field of DEPENDENCY_FIELDS) {
                const deps = pkg?.[field];
                if (isObject(deps)) {
                    for (const key of Object.keys(deps)) {
                        names.add(normalizeNodeName(key));
                    }
                }
            }
        }
        return names;
    }

    private collectScripts(): ReadonlySet<string> {
        const names = new Set<string>();
        for (const { pkg } of this.packages()) {
            const scripts = pkg?.["scripts"];
            if (isObject(scripts)) {
                for (const key of Object.keys(scripts)) {
                    names.add(key);
                }
            }
        }
        return names;
    }

    /** Each package.json in the root/workspace pair, parsed exactly once. */
    private packages(): readonly PackageContext[] {
        this.packagesCache ??= this.packageDirs().map((dir) => ({
            dir,
            pkg: parseJsonObject(this.fs.readText(join(dir, PACKAGE_JSON))),
        }));
        return this.packagesCache;
    }

    private packageDirs(): readonly string[] {
        return this.workspaceRoot === this.root
            ? [this.root]
            : [this.root, this.workspaceRoot];
    }
}
