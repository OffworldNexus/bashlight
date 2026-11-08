/**
 * The OpenCode v2 plugin: the composition root for the live path.
 *
 * This is the only place the adapter reads `process.env`, builds the real
 * `NodeFileSystem`, picks the audit sink and wires the session-directory cache.
 * Everything below it is injected, so the interceptor is tested with fakes.
 *
 * Options (from `plugins: [{ package, options }]`):
 *   - `auditLog`: a file path, or `false` to disable auditing. Defaults to
 *     `$XDG_DATA_HOME/bashlight/audit.jsonl`, falling back to
 *     `~/.local/share/bashlight/audit.jsonl`.
 *   - `disabledRules`: rule ids the core should not apply.
 */

import { Plugin, type PluginOptions } from "@opencode/plugin";

import { createBashlight } from "../bashlight.ts";
import { NodeFileSystem } from "../project/index.ts";
import {
    type AuditLog,
    defaultAuditLogPath,
    type Environment,
    JsonlAuditLog,
    NoopAuditLog,
} from "./audit-log.ts";
import { ConsoleLogger, type Logger } from "./logger.ts";
import { SessionDirectoryCache } from "./session-directory-cache.ts";
import { ShellInterceptor } from "./shell-interceptor.ts";

/** Resolved plugin options. */
export interface BashlightPluginOptions {
    readonly auditLog: string | false;
    readonly disabledRules: readonly string[];
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
    const interceptor = new ShellInterceptor({
        processor: createBashlight({
            fileSystem: new NodeFileSystem(),
            disabledRules: options.disabledRules,
        }),
        auditLog: createAuditLog(options.auditLog, logger),
        logger,
        env: currentEnv,
        directoryFor: createDirectoryResolver(ctx, logger),
    });

    const registration = await ctx.tool.hook("execute.before", (event) =>
        interceptor.handle(event),
    );
    return async () => {
        await registration.dispose();
    };
}

export default Plugin.define({ id: "bashlight", setup });
