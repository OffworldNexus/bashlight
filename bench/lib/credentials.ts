/* eslint-disable sonarjs/function-return-type -- the credential lookup returns undefined when absent */
/**
 * Where the benchmark gets its OpenRouter credential.
 *
 * The key is read at runtime from the user's own OpenCode auth store — the
 * same place `opencode auth login` writes — or, failing that, from the
 * environment. It is passed to the child only through its environment: never
 * written to disk, never printed, never logged. This module deliberately has
 * no `console` calls.
 */

/** The slice of the environment and filesystem this module needs. */
export interface CredentialSource {
    readonly env: Readonly<Record<string, string | undefined>>;
    /** Reads a UTF-8 file, or returns `undefined` when it does not exist. */
    readText(path: string): string | undefined;
}

/** Resolves the OpenRouter API key from the user's OpenCode auth store. */
export class OpenRouterCredentials {
    constructor(private readonly source: CredentialSource) {}

    /**
     * The key, preferring the environment override (useful for CI) over the
     * auth store. Throws a message without the key when neither has one.
     */
    key(): string {
        const fromEnv = this.source.env.OPENROUTER_API_KEY;
        if (fromEnv !== undefined && fromEnv !== "") {
            return fromEnv;
        }
        for (const path of this.authPaths()) {
            const found = this.fromAuthFile(path);
            if (found !== undefined) {
                return found;
            }
        }
        throw new Error(
            "no OpenRouter credential found: set OPENROUTER_API_KEY or run `opencode auth login`",
        );
    }

    /** Candidate auth.json locations, honouring XDG then falling back to HOME. */
    private authPaths(): readonly string[] {
        const env = this.source.env;
        const dataHome = this.dataHome(env);
        return dataHome === undefined ? [] : [`${dataHome}/opencode/auth.json`];
    }

    private dataHome(
        env: Readonly<Record<string, string | undefined>>,
    ): string | undefined {
        if (env.XDG_DATA_HOME !== undefined && env.XDG_DATA_HOME !== "") {
            return env.XDG_DATA_HOME;
        }
        if (env.HOME !== undefined && env.HOME !== "") {
            return `${env.HOME}/.local/share`;
        }
        return undefined;
    }

    /** The `openrouter` entry's `key` field, which auth.json stores as a string. */
    private fromAuthFile(path: string): string | undefined {
        const text = this.source.readText(path);
        if (text === undefined) {
            return undefined;
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(text);
        } catch {
            return undefined;
        }
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            return undefined;
        }
        const entry = (parsed as Record<string, unknown>).openrouter;
        if (typeof entry === "string" && entry !== "") {
            return entry;
        }
        if (typeof entry === "object" && entry !== null) {
            const key = (entry as Record<string, unknown>).key;
            if (typeof key === "string" && key !== "") {
                return key;
            }
        }
        return undefined;
    }
}
