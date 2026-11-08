/**
 * The contract between bashlight's core and its hosts (the OpenCode plugin,
 * tests, a future CLI): give it a command and where it runs, get back what
 * should actually run.
 */

export interface ProcessRequest {
    /** The bash command exactly as the agent wrote it. */
    readonly command: string;
    /** Absolute directory the command starts in. */
    readonly cwd: string;
    /** The environment the shell will inherit (treated as complete). */
    readonly env: Readonly<Record<string, string>>;
    /**
     * The project root the command belongs to, when it differs from `cwd`.
     * Custom rules are looked up relative to it; it defaults to `cwd`.
     */
    readonly projectDir?: string;
}

/** One command that a rule changed, for audit logs and debugging. */
export interface Change {
    readonly ruleIds: readonly string[];
    readonly reasons: readonly string[];
    /** The effective command before and after, as display strings. */
    readonly before: string;
    readonly after: string;
}

export type Outcome =
    | {
          readonly kind: "unchanged";
          /** Why nothing was rewritten when a rule wanted to (fail-open). */
          readonly reason?: string;
      }
    | {
          readonly kind: "rewritten";
          readonly command: string;
          readonly changes: readonly Change[];
      }
    | {
          readonly kind: "blocked";
          /** Shown to the agent instead of the command output. */
          readonly message: string;
          readonly ruleIds: readonly string[];
      };

export interface CommandProcessor {
    /** Never throws: any internal failure yields `unchanged`. */
    process(request: ProcessRequest): Outcome;
}
