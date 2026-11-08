/**
 * Where and with which environment a command runs, as far as static analysis
 * can tell. Shared by the interpreter (which computes it) and the rules (which
 * read it).
 */

/** The machine (or container) a command runs on. */
export type Host =
    | { readonly kind: "local" }
    | {
          readonly kind: "remote";
          /** The wrapper that leaves the local machine: `ssh`, `docker`… */
          readonly via: string;
          /** Host, container or pod name when statically known. */
          readonly target: string | undefined;
      };

/** What we know about a variable at a given point of the script. */
export type VariableState =
    | { readonly kind: "set"; readonly value: string }
    /** Set, but to a value we cannot compute (`$(…)`, `$1`, branches…). */
    | { readonly kind: "unknown" }
    /** Definitely not set (e.g. after `unset`, or `env -i`). */
    | { readonly kind: "unset" };

/** Read-only view of the variables visible to a command. */
export interface EnvironmentView {
    lookup(name: string): VariableState;
}

export interface ExecutionContext {
    /** Absolute working directory, or undefined when it cannot be known. */
    readonly cwd: string | undefined;
    readonly host: Host;
    readonly env: EnvironmentView;
}

export const LOCAL_HOST: Host = Object.freeze({ kind: "local" });
