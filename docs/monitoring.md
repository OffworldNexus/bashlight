# Monitoring

bashlight hides itself from the agent, not from you. Everything it does is written to an
audit log, and a small CLI turns that log — and the installation — into something you
can read.

Install the alias first, so every example below is copy-pasteable:

```bash
alias bashlight='bunx --package github:OffworldNexus/bashlight bashlight'
```

After the npm release, `bunx bashlight` is enough. Every command that reads the log
accepts `--log PATH` for a non-default file.

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

## `bashlight watch`

Prints the current tail — the last 20 entries, or everything inside `--since` — then
follows the file, one block per entry. `--all` also shows unchanged commands (hidden by
default), `--no-color` drops the colour, and Ctrl-C exits.

```console
$ bashlight watch --since 10m
2026-11-08 15:12:04  ses_1234  ~/dev/shop
  - pip install requests
  + poetry add requests
  rules: pip-to-manager  reasons: install with the project manager
```

## `bashlight stats`

Summarises the log over a window (default `7d`): totals, per-rule counts, per-day
outcomes, the most common rewrite pairs and the busiest directories. `--json` prints the
same data as an object.

```console
$ bashlight stats --since 7d
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

Outcomes per day:
  2026-11-07  rewritten 14  blocked 1  unchanged 4
  2026-11-08  rewritten 17  blocked 1  unchanged 5

Top rewrites:
    12  pip install → poetry add
     3  npm install → pnpm add

Top working directories:
    25  ~/dev/shop
     9  ~/dev/blog
```

## `bashlight explain`

Dry-runs one command through the real pipeline with the real filesystem and your current
environment — including [your own rules](rules.md#your-own-rules) — without executing
anything. The command is one quoted argument, the remaining arguments joined with
spaces, or `-` to read it from stdin. `--cwd DIR` is the directory to interpret in (and
the project whose rules apply), `--env-file F` overlays a `.env`-style file.

```console
$ bashlight explain 'pip install requests' --cwd ~/dev/shop
rewritten:
  - pip install requests
  + poetry add requests
changes:
  - rules: pip-to-manager  reasons: install with the project manager
      pip install requests → poetry add requests
```

## `bashlight rules`

Lists the rules in effect, in priority order: your custom rules first (with the file
they came from), then the built-ins, plus any you disabled and any file that failed to
load. It is the fastest way to see why a rule never fires.

```console
$ bashlight rules --cwd ~/dev/shop
bashlight rules in /home/user/dev/shop

Active:
   1  make-test         project  /home/user/dev/shop/.opencode/bashlight/rules/make-test.ts
   2  redundant-runner  builtin
   3  pip-to-manager    builtin
   …
```

## `bashlight trust` / `bashlight untrust`

A project's [own rules](rules.md#your-own-rules) are code that runs with your full
privileges, so they stay disabled until you allow them. `bashlight trust [DIR]`
(default: the current directory) trusts a project and prints the rule files it enables;
`bashlight untrust [DIR]` removes it again. Global rules are always trusted, and
`customRules: false` disables all custom rules.

```console
$ bashlight trust ~/dev/shop
trusted /home/user/dev/shop
  enables /home/user/dev/shop/.opencode/bashlight/rules/make-test.ts
```

Until a project is trusted, `bashlight rules` and `bashlight doctor` report how many
project rule files were found but skipped.

## `bashlight doctor`

Diagnoses the whole installation: the runtime versions, whether the plugin is
discoverable, the custom rules, the audit log, and an end-to-end self-test of the
pipeline.

```console
$ bashlight doctor
✓ bun 1.3.14
✓ opencode opencode v2.2.5
✓ plugin discoverability (config: /home/user/.config/opencode/opencode.json)
✓ custom rules
✓ audit log /home/user/.local/share/bashlight/audit.jsonl (2103 bytes, last entry 2026-11-08T15:12:04.117Z)
✓ self-test: pip install requests → poetry add requests
```

## Troubleshooting

| Symptom                                             | Fix                                                                                                                                                                                                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Nothing is ever rewritten                           | the plugin is not loaded. Run `bashlight doctor`; if it fails discoverability, add the [one line](getting-started.md#1-add-bashlight-to-opencodejson). Otherwise check OpenCode's log under `~/.local/share/opencode/log/` for `failed to load plugin` |
| `doctor` warns that the audit log is idle           | no shell call has gone through in the last day. Confirm the plugin is enabled, then run one command and check again                                                                                                                                    |
| A rule changes something it should not              | list its id in [`disabledRules`](getting-started.md#options)                                                                                                                                                                                           |
| A custom rule never fires                           | `bashlight rules` shows it (or the load error) and `bashlight explain` shows the rewrite; a rule file has no runtime import of bashlight, only the `helpers` it is handed                                                                              |
| `rules`/`doctor` say project rules are not trusted  | a project's rule files run with your full privileges, so they are skipped until you allow them: `bashlight trust <dir>`. Global rules are always loaded; `customRules: false` turns them all off                                                       |
| A custom rule disappeared after an edit             | the whole rules folder reloads on any change; check `bashlight rules` for a load error (a bad import, a thrown factory, or a file over the 2 s budget)                                                                                                 |
| The audit log is huge                               | it is append-only by design: rotate or truncate it. `bashlight watch` and `stats` cope with a rotated file                                                                                                                                             |
| You want to know what it would do before it does it | `bashlight explain '<command>' --cwd <dir>` — same code, no execution                                                                                                                                                                                  |

## Where next

- [How it works](how-it-works.md) — the pipeline the CLI dry-runs.
- [Rules](rules.md) — what the ids in the log mean, and how to write your own.
