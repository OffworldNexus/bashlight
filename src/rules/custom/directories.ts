/**
 * Where custom rule files live.
 *
 * Two directories, in priority order: the project's own
 * `<project>/.opencode/bashlight/rules/`, then the global
 * `<config>/bashlight/rules/` (where `<config>` is the OpenCode config
 * directory, `~/.config/opencode`). The config directory is injected so this
 * module stays pure and testable.
 */

import { join } from "../../shared/posix-path.ts";

/** Which directory a rule file came from. */
export type RuleOrigin = "project" | "global";

export interface RuleDirectory {
    readonly origin: RuleOrigin;
    readonly path: string;
}

export class RuleDirectories {
    /** `configDir` is the OpenCode config directory (`~/.config/opencode`). */
    constructor(private readonly configDir: string) {}

    /** The project directory's rule folder. */
    project(directory: string): RuleDirectory {
        return {
            origin: "project",
            path: join(directory, ".opencode", "bashlight", "rules"),
        };
    }

    /** The global rule folder. */
    global(): RuleDirectory {
        return { origin: "global", path: join(this.configDir, "bashlight", "rules") };
    }

    /** Project first (more specific), then global. */
    all(directory: string): readonly RuleDirectory[] {
        return [this.project(directory), this.global()];
    }
}
