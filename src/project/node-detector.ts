import type { ToolchainDetector } from "./detector.ts";
import type { FileSystem } from "./file-system.ts";
import { type JsonObject, parseJsonObject } from "./json.ts";
import {
    BUN_LOCK,
    BUN_LOCKB,
    NPM_LOCK,
    PACKAGE_JSON,
    PNPM_LOCK,
    PNPM_WORKSPACE,
    YARN_LOCK,
} from "./manifests.ts";
import { NodeToolchainImpl } from "./node-toolchain.ts";
import { join, nearestSelfOrAncestor } from "./posix-path.ts";
import { NODE_MANAGERS, type NodeManager, type NodeToolchain } from "./toolchain.ts";

/** Lockfiles mapped to their manager, in detection precedence order. */
const LOCKFILE_MANAGERS: readonly (readonly [string, NodeManager])[] = [
    [PNPM_LOCK, "pnpm"],
    [BUN_LOCK, "bun"],
    [BUN_LOCKB, "bun"],
    [YARN_LOCK, "yarn"],
    [NPM_LOCK, "npm"],
];

/** A directory is a workspace boundary if it has any of these. */
const WORKSPACE_BOUNDARIES: readonly string[] = [
    PNPM_WORKSPACE,
    ...LOCKFILE_MANAGERS.map(([file]) => file),
];

function identifyManager(spec: string): NodeManager | undefined {
    const [namePart] = spec.split("@");
    const name = (namePart ?? "").trim().toLowerCase();
    return NODE_MANAGERS.find((manager) => manager === name);
}

/**
 * Finds the innermost directory with a `package.json` (`root`), the nearest
 * ancestor-or-self that is a workspace boundary (`workspaceRoot`) and the
 * manager.
 *
 * Manager resolution: the `packageManager` field of `root`, then of
 * `workspaceRoot`, then the lockfile at `workspaceRoot`. When neither yields a
 * known manager the project has no toolchain: rules must not guess.
 */
export class NodeToolchainDetector implements ToolchainDetector<NodeToolchain> {
    constructor(private readonly fs: FileSystem) {}

    detect(dir: string): NodeToolchain | undefined {
        const root = this.findRoot(dir);
        return root === undefined ? undefined : this.detectAt(root);
    }

    private detectAt(root: string): NodeToolchain | undefined {
        const workspaceRoot = this.findWorkspaceRoot(root);
        const manager = this.resolveManager(root, workspaceRoot);
        return manager === undefined
            ? undefined
            : new NodeToolchainImpl(this.fs, manager, root, workspaceRoot);
    }

    private findRoot(dir: string): string | undefined {
        return nearestSelfOrAncestor(dir, (candidate) =>
            this.fs.exists(join(candidate, PACKAGE_JSON)),
        );
    }

    private findWorkspaceRoot(root: string): string {
        return (
            nearestSelfOrAncestor(root, (candidate) => this.isBoundary(candidate)) ??
            root
        );
    }

    private isBoundary(dir: string): boolean {
        const hasLockfile = WORKSPACE_BOUNDARIES.some((file) =>
            this.fs.exists(join(dir, file)),
        );
        return hasLockfile || this.packageJson(dir)?.["workspaces"] !== undefined;
    }

    private resolveManager(
        root: string,
        workspaceRoot: string,
    ): NodeManager | undefined {
        const fromField =
            this.managerFromField(root) ??
            (workspaceRoot === root ? undefined : this.managerFromField(workspaceRoot));
        return fromField ?? this.managerFromLockfile(workspaceRoot);
    }

    private managerFromField(dir: string): NodeManager | undefined {
        const value = this.packageJson(dir)?.["packageManager"];
        return typeof value === "string" ? identifyManager(value) : undefined;
    }

    private managerFromLockfile(dir: string): NodeManager | undefined {
        const match = LOCKFILE_MANAGERS.find(([file]) =>
            this.fs.exists(join(dir, file)),
        );
        return match?.[1];
    }

    private packageJson(dir: string): JsonObject | undefined {
        return parseJsonObject(this.fs.readText(join(dir, PACKAGE_JSON)));
    }
}
