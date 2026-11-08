/**
 * Isolating a benchmark run from the user's own OpenCode setup.
 *
 * Every run gets its own XDG tree, its own `HOME`, and a minimal
 * `opencode.json` with no MCP servers and no plugins (except bashlight, in
 * `with` mode). The child environment is built from a small allowlist rather
 * than inherited wholesale, so user config, credentials and MCP servers cannot
 * leak in. The OpenRouter key is passed only here, through the environment.
 */

import type { BenchFileSystem } from "./fs.ts";
import type { Mode } from "./types.ts";

/** Everything {@link Isolation.setup} needs to build a run environment. */
export interface IsolationInput {
    /** The per-run scratch root, e.g. `/tmp/opencode/bench-runs/<id>`. */
    readonly runDirectory: string;
    /** The fresh project copy the agent works in. */
    readonly projectDirectory: string;
    /** Shared package-manager cache root (poetry, uv, pip, pnpm). */
    readonly sharedCache: string;
    /** The OpenRouter key; never written down. */
    readonly apiKey: string;
    /** The parent environment, used only for the allowlisted keys. */
    readonly parentEnv: Readonly<Record<string, string | undefined>>;
}

/** What the runner needs back after the isolation tree is in place. */
export interface IsolatedEnvironment {
    readonly env: Readonly<Record<string, string>>;
    readonly configPath: string;
    readonly auditLogPath: string;
}

const INHERITED_KEYS = ["PATH", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "SHELL"] as const;

/** The minimal `opencode.json` written into every run's config directory. */
function configDocument(): string {
    return `${JSON.stringify(
        {
            $schema: "https://opencode.ai/config.json",
            update: "disable",
            share: "disabled",
            snapshots: false,
            permissions: [
                { action: "shell", resource: "sudo *", effect: "deny" },
                {
                    action: "shell",
                    resource: "*--break-system-packages*",
                    effect: "deny",
                },
                { action: "shell", resource: "pip install --user*", effect: "deny" },
            ],
        },
        null,
        4,
    )}\n`;
}

/** Builds per-run XDG/HOME trees and the isolated OpenCode config. */
export class Isolation {
    constructor(private readonly fs: BenchFileSystem) {}

    setup(input: IsolationInput): IsolatedEnvironment {
        const run = input.runDirectory;
        const configHome = `${run}/config`;
        const dataHome = `${run}/data`;
        const stateHome = `${run}/state`;
        const cacheHome = `${run}/cache`;
        const home = `${run}/home`;
        for (const directory of [configHome, dataHome, stateHome, cacheHome, home]) {
            this.fs.mkdirp(directory);
        }
        const configPath = `${configHome}/opencode/opencode.json`;
        this.fs.writeFile(configPath, configDocument());
        return {
            env: this.buildEnv(input, {
                run,
                configHome,
                dataHome,
                stateHome,
                cacheHome,
                home,
            }),
            configPath,
            auditLogPath: `${dataHome}/bashlight/audit.jsonl`,
        };
    }

    /**
     * Adds the bashlight plugin to a prepared project copy (`with` mode) or
     * clears any project-local `.opencode` so nothing is discovered
     * (`without` mode). Called after the template has been copied.
     */
    installPlugin(input: {
        readonly projectDirectory: string;
        readonly mode: Mode;
        readonly pluginEntry: string;
    }): void {
        if (input.mode === "without") {
            this.fs.remove(`${input.projectDirectory}/.opencode`);
            return;
        }
        this.fs.writeFile(
            `${input.projectDirectory}/.opencode/plugins/bashlight.ts`,
            `export { default } from ${JSON.stringify(input.pluginEntry)};\n`,
        );
    }

    /** Assembles the child environment from the allowlist plus bench values. */
    private buildEnv(
        input: IsolationInput,
        homes: {
            readonly run: string;
            readonly configHome: string;
            readonly dataHome: string;
            readonly stateHome: string;
            readonly cacheHome: string;
            readonly home: string;
        },
    ): Readonly<Record<string, string>> {
        const env: Record<string, string> = {};
        for (const key of INHERITED_KEYS) {
            const value = input.parentEnv[key];
            if (value !== undefined && value !== "") {
                env[key] = value;
            }
        }
        const cache = input.sharedCache;
        Object.assign(env, {
            HOME: homes.home,
            PWD: input.projectDirectory,
            TERM: "dumb",
            NO_COLOR: "1",
            CI: "1",
            XDG_CONFIG_HOME: homes.configHome,
            XDG_DATA_HOME: homes.dataHome,
            XDG_STATE_HOME: homes.stateHome,
            XDG_CACHE_HOME: homes.cacheHome,
            OPENCODE_TEST_HOME: homes.home,
            OPENROUTER_API_KEY: input.apiKey,
            PIP_REQUIRE_VIRTUALENV: "1",
            POETRY_CACHE_DIR: `${cache}/poetry`,
            POETRY_VIRTUALENVS_IN_PROJECT: "true",
            UV_CACHE_DIR: `${cache}/uv`,
            PIP_CACHE_DIR: `${cache}/pip`,
            npm_config_cache: `${cache}/npm`,
            npm_config_store_dir: `${cache}/pnpm-store`,
        });
        return env;
    }
}
