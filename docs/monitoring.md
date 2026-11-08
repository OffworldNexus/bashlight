# Monitoring

bashlight hides itself from the agent, not from you. Everything it does is written to an
audit log, and four CLI commands turn that log — and the installation — into something
you can read.

## The audit log

The plugin appends one JSON object per line to the audit log. The default path is
`$XDG_DATA_HOME/bashlight/audit.jsonl`, falling back to
`~/.local/share/bashlight/audit.jsonl`; `auditLog` in the
[plugin options](getting-started.md#options) changes it or disables it.

```json title="audit.jsonl"
{
    "time": "2026-11-08T15:12:04.117Z",
    "sessionID": "ses_1234",
    "callID": "call_56",
    "cwd": "/home/user/dev/shop",
    "original": "pip install requests",
    "outcome": "rewritten",
    "command": "poetry add requests",
    "ruleIds": ["pip-to-manager"],
    "reasons": ["install with the project manager"]
}
```

The fields are: `time`, `sessionID`, `callID`, `cwd`, the `original` command, the
`outcome` (`rewritten`, `blocked` or `unchanged`), the `command` that ran (present only
when rewritten), the `message` (when blocked), and the `ruleIds` and `reasons` behind
the verdict. The log is append-only and **grows without bound** — rotate or truncate it
when it gets large, for example with `logrotate`.

## The CLI

Run it with `bun bin/bashlight` from the checkout (or `bun run cli`). Every command that
reads the log accepts `--log PATH` for a non-default file.

### `bashlight watch`

Prints the current tail — the last 20 entries, or everything inside `--since` — then
follows the file, one block per entry. `--all` also shows unchanged commands (hidden by
default), `--no-color` drops the colour, and Ctrl-C exits.

```console
$ bun bin/bashlight watch --since 10m
2026-11-08 15:12:04  ses_1234  ~/dev/shop
  - pip install requests
  + poetry add requests
  rules: pip-to-manager  reasons: install with the project manager
```

### `bashlight stats`

Summarises the log over a window (default `7d`): totals, per-rule counts, per-day
outcomes, the most common rewrite pairs and the busiest directories. `--json` prints the
same data as an object.

```console
$ bun bin/bashlight stats --since 7d
Audit log: /home/user/.local/share/bashlight/audit.jsonl
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
    25  ~/dev/shop
     9  ~/dev/blog
```

### `bashlight explain`

Dry-runs one command through the real pipeline with the real filesystem and your current
environment, without executing anything. The command is one quoted argument, the
remaining arguments joined with spaces, or `-` to read it from stdin. `--cwd DIR` is the
directory to interpret in, `--env-file F` overlays a `.env`-style file.

```console
$ bun bin/bashlight explain 'pip install requests' --cwd ~/dev/shop
rewritten:
  - pip install requests
  + poetry add requests
changes:
  - rules: pip-to-manager  reasons: install with the project manager
      pip install requests → poetry add requests
```

### `bashlight doctor`

Diagnoses the whole installation: the runtime versions, whether the plugin is
discoverable, the audit log, and an end-to-end self-test of the pipeline.

```console
$ bun bin/bashlight doctor
✓ bun 1.3.14
✓ opencode opencode v2.2.5
✓ plugin discoverability (project: /home/user/dev/shop/.opencode/plugins/bashlight.ts)
✓ audit log /home/user/.local/share/bashlight/audit.jsonl (2.1 kB, last entry 2026-11-08T15:12:04.117Z)
✓ self-test: pip install requests → poetry add requests
```

## Troubleshooting

| Symptom                                             | Fix                                                                                                                                                                                                                                                  |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nothing is ever rewritten                           | the plugin is not loaded. Run `bashlight doctor`; if it fails discoverability, add the [plugin file](getting-started.md#2-point-opencode-at-it). Otherwise check OpenCode's own log under `~/.local/share/opencode/log/` for `failed to load plugin` |
| `doctor` warns that the audit log is idle           | no shell call has gone through in the last day. Confirm the plugin is enabled, then run one command and check again                                                                                                                                  |
| A rule changes something it should not              | list its id in [`disabledRules`](getting-started.md#options), or leave it out of your own `rules` set                                                                                                                                                |
| The audit log is huge                               | it is append-only by design: rotate or truncate it. `bashlight watch` and `stats` cope with a rotated file                                                                                                                                           |
| You want to know what it would do before it does it | `bashlight explain '<command>' --cwd <dir>` — same code, no execution                                                                                                                                                                                |

## Where next

- [How it works](how-it-works.md) — the pipeline the CLI dry-runs.
- [Rules](rules.md) — what the ids in the log mean.
