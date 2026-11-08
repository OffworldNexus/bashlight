# bashlight

bashlight sits between an LLM agent and the shell. When the agent runs a bash command,
bashlight parses it, **statically** pre-interprets it (nothing is executed), finds every
command that will run, and rewrites the ones that do not match the project's conventions
— `pip install requests` in a Poetry project becomes `poetry add requests`. The
rewritten command is what actually runs; the agent keeps seeing its own command in the
history.

bashlight fails open: unparseable input, unknown values or any internal error leave the
command untouched. Only an explicit `block` verdict stops a command.

## Enabling it

**Project-local** (already configured in this repo): `.opencode/plugins/bashlight.ts`
only re-exports the plugin.

```ts
export { default } from "../../src/opencode/plugin.ts";
```

**Globally**, create `~/.config/opencode/plugins/bashlight.ts` containing the absolute
path of the plugin entry point:

```ts
export { default } from "/absolute/path/to/bashlight/src/opencode/plugin.ts";
```

Alternatively, list `bashlight` in the `plugins` array of
`~/.config/opencode/opencode.json`.

## Plugin options

Passed through OpenCode's `plugins: [{ package, options }]`:

- `auditLog`: a file path, or `false` to disable auditing. Defaults to
  `$XDG_DATA_HOME/bashlight/audit.jsonl`, falling back to
  `~/.local/share/bashlight/audit.jsonl`.
- `disabledRules`: rule ids the core should not apply, for example `["node-manager"]`.

## Checking that it works

`bashlight` ships a small CLI so you can see exactly what the plugin does. Run it with
`bun bin/bashlight` (or `bun run cli` from the repo root). Every command takes
`--log PATH` to point at a non-default audit log.

### `bashlight doctor`

Diagnoses the installation: runtime versions, plugin discoverability, the audit log and
a live end-to-end self-test. `✗` fails (exit code 1), `⚠` warns, `✓` passes.

```
$ bun bin/bashlight doctor
✓ bun 1.3.14
✓ opencode opencode v2.2.5
✓ plugin discoverability (project: /repo/.opencode/plugins/bashlight.ts)
✓ audit log /home/u/.local/share/bashlight/audit.jsonl (0 bytes, no entries yet)
⚠ audit log is idle — no shell call seen recently — is the plugin loaded? check ~/.local/share/opencode/log/ for 'failed to load plugin'
✓ self-test: pip install requests → poetry add requests
```

### `bashlight explain <command…>`

Dry-runs a command through the real pipeline with the real file system and the current
environment, without executing anything. The command is one quoted argument, the
remaining arguments joined with spaces, or `-` to read it from stdin.

```
$ bun bin/bashlight explain 'pip install requests' --cwd /path/to/poetry/project
rewritten:
  - pip install requests
  + poetry add requests
changes:
  - rules: pip-to-manager  reasons: install with the project manager
      pip install requests → poetry add requests
```

```
$ bun bin/bashlight explain 'pip install requests' --cwd /tmp
blocked:
  Installing packages with pip outside a project is disabled. Use a PEP 723 script …
```

### `bashlight watch`

Prints the current tail (the last 20 entries, or those inside `--since`) and then
follows the log, one block per entry. `--all` also shows unchanged commands (hidden by
default); `--no-color` disables colour; Ctrl-C exits.

```
$ bun bin/bashlight watch --since 10m
2026-11-08 15:12:04  ses_1234  ~/proj
  - pip install requests
  + poetry add requests
  rules: pip-to-manager  reasons: install with the project manager
```

### `bashlight stats`

Summarises the log (default window: 7 days): totals, per-rule counts, per-day outcomes,
the most common rewrite pairs and the busiest working directories. `--json` prints a
machine-readable object.

```
$ bun bin/bashlight stats --since 7d
Audit log: /home/u/.local/share/bashlight/audit.jsonl
Window: last 7d

Entries:      42
Rewritten:    31 (74%)
Blocked:      2
Unchanged:    9

Rules:
    18  pip-to-manager
     7  python-runner
     4  node-manager

Top rewrites:
    12  pip install → poetry add
     3  npm install → pnpm add

Top working directories:
    25  ~/proj
     9  ~/other
```

## The audit log

The plugin appends one JSON object per line to the audit log (default
`$XDG_DATA_HOME/bashlight/audit.jsonl`, else `~/.local/share/bashlight/audit.jsonl`).
Each line records the session, call id, cwd, the original and rewritten commands, the
outcome and the rule ids and reasons. `bashlight watch` and `bashlight stats` read it;
malformed lines are skipped.

The log is append-only and **grows without bound** — rotate or truncate it when it gets
large (for example with `logrotate`).
