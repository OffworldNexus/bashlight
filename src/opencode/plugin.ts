/**
 * The OpenCode v2 plugin: the composition root for the live path.
 *
 * This is the only place the adapter reads `process.env`, builds the real
 * `NodeFileSystem`, picks the audit sink and wires the session-directory cache.
 * Everything below it is injected, so the interceptor is tested with fakes.
 *
 * `@opencode/plugin` is imported type-only: the plugin is packaged with no
 * runtime dependencies, and OpenCode's loader accepts a plain
 * `{ id, setup }` default export.
 *
 * Options (from `plugins: [{ package, options }]`):
 *   - `auditLog`: a file path, or `false` to disable auditing. Defaults to
 *     `$XDG_DATA_HOME/bashlight/audit.jsonl`, falling back to
 *     `~/.local/share/bashlight/audit.jsonl`.
 *   - `disabledRules`: rule ids the core should not apply.
 *   - `customRules`: `false` drops every custom rule (project and global);
 *     defaults to true. Project rules are only loaded once their directory is
 *     trusted with `bashlight trust`.
 */

import type { Plugin, PluginOptions } from "@opencode/plugin";

import { createBashlight } from "../bashlight.ts";
import { NodeFileSystem } from "../project/index.ts";
import {
    type AuditLog,
    configDirectory,
    defaultAuditLogPath,
    type Environment,
    JsonlAuditLog,
    NoopAuditLog,
} from "./audit-log.ts";
import { ConsoleLogger, type Logger, LoggingRuleErrorSink } from "./logger.ts";
import { createRuleCatalog } from "./rule-catalog.ts";
import { SessionDirectoryCache } from "./session-directory-cache.ts";
import { ShellInterceptor } from "./shell-interceptor.ts";

/** Resolved plugin options. */
export interface BashlightPluginOptions {
    readonly auditLog: string | false;
    readonly disabledRules: readonly string[];
    readonly customRules: boolean;
}

function asString(value: unknown): string | undefined {
    return typeof value === "string" && value !== "" ? value : undefined;
}

function asStringArray(value: unknown): readonly string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter(
        (item): item is string => typeof item === "string" && item !== "",
    );
}

/** Reads the plugin options, ignoring anything malformed. */
export function readOptions(
    options: PluginOptions,
    env: Environment,
): BashlightPluginOptions {
    return {
        auditLog:
            options.auditLog === false
                ? false
                : (asString(options.auditLog) ?? defaultAuditLogPath(env)),
        disabledRules: asStringArray(options.disabledRules),
        customRules: options.customRules !== false,
    };
}

function createAuditLog(target: string | false, logger: Logger): AuditLog {
    return target === false
        ? new NoopAuditLog()
        : new JsonlAuditLog(target, { now: () => new Date() }, logger);
}

/** The current environment without the `undefined`-valued entries. */
function currentEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) {
            env[key] = value;
        }
    }
    return env;
}

/** Builds the session-directory cache backing the interceptor's `directoryFor`. */
function createDirectoryResolver(
    ctx: Plugin.Context,
    logger: Logger,
): (sessionID: string) => Promise<string> {
    const cache = new SessionDirectoryCache({
        lookup: async (sessionID) =>
            (await ctx.session.get({ sessionID })).location.directory,
        fallback: ctx.location.directory,
        logger,
    });
    return (sessionID) => cache.directoryFor(sessionID);
}

/** Registers the shell interceptor and returns the plugin cleanup. */
export async function setup(ctx: Plugin.Context): Promise<Plugin.Cleanup> {
    const options = readOptions(ctx.options, process.env);
    const logger = new ConsoleLogger();
    const catalog = createRuleCatalog({
        configDir: configDirectory(process.env),
        reporter: logger,
        disabledRules: options.disabledRules,
        customRules: options.customRules,
    });
    const interceptor = new ShellInterceptor({
        processor: createBashlight({
            fileSystem: new NodeFileSystem(),
            rulesFor: (directory) => catalog.rulesFor(directory),
            ruleErrors: new LoggingRuleErrorSink(logger),
        }),
        auditLog: createAuditLog(options.auditLog, logger),
        logger,
        env: currentEnv,
        directoryFor: createDirectoryResolver(ctx, logger),
        refreshRules: (directory) => catalog.refresh(directory),
    });

    const registration = await ctx.tool.hook("execute.before", (event) =>
        interceptor.handle(event),
    );
    return async () => {
        await registration.dispose();
    };
}

/** The OpenCode v2 promise plugin shape (`{ id, setup }`). */
type PluginDefinition = {
    readonly id: string;
    readonly setup: (ctx: Plugin.Context) => Promise<Plugin.Cleanup>;
};

export default {
    id: "bashlight",
    setup,
} satisfies PluginDefinition;
