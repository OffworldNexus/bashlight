# Getting started

You never clone anything. bashlight is a package OpenCode installs for you; the CLI is a
one-liner you can run before you install it.

## Requirements

- **OpenCode** v2.2 or newer — bashlight is a plugin.
- **Bun** for the CLI (the plugin itself needs no runtime, OpenCode provides its own).
  The CLI runs it with `bunx`, so you only need it on `PATH`.
- A project whose conventions you want enforced: Poetry, uv, pipenv, PDM or a bare venv
  for Python; npm, pnpm, yarn or Bun for Node.

## 1. Add bashlight to `opencode.json`

bashlight is **unreleased**: install it from GitHub for now. Add one line to the
`plugins` array — of your project's `opencode.json`, or of
`~/.config/opencode/opencode.json` to enable it in every project:

```json title="~/.config/opencode/opencode.json"
{
    "plugins": ["github:OffworldNexus/bashlight"]
}
```

Once it is published to npm, this becomes the shorter `"plugins": ["bashlight"]`.

## 2. Restart OpenCode

OpenCode installs configured plugins at startup and loads bashlight's `server`
entrypoint. Nothing else to configure — no plugin file to write, no build step.

A project's `opencode.json` and the global one are both read; the entry can also be an
object when you want to pass [options](#options).

## 3. Check that it is live

Run `bashlight doctor`. It reads your environment and runs the pipeline end to end
without touching a project:

```console
$ bunx --package github:OffworldNexus/bashlight bashlight doctor
✓ bun 1.3.14
✓ opencode opencode v2.2.5
✓ plugin discoverability (config: /home/user/.config/opencode/opencode.json)
✓ custom rules
✓ audit log /home/user/.local/share/bashlight/audit.jsonl (2103 bytes, last entry 2026-11-08T15:12:04.117Z)
✓ self-test: pip install requests → poetry add requests
```

`✗` is a failure (exit code 1), `⚠` a warning. If discoverability fails, `doctor` prints
the exact `opencode.json` snippet to add. The one warning worth reading is
`audit log is idle`: it means no shell call has gone through in the last day, which
usually means the plugin is not loaded — see
[monitoring](monitoring.md#troubleshooting).

Then ask what it would do to a real command, in a real directory:

```console
$ bashlight explain 'pip install requests' --cwd ~/dev/shop
rewritten:
  - pip install requests
  + poetry add requests
changes:
  - rules: pip-to-manager  reasons: install with the project manager
      pip install requests → poetry add requests
```

`explain` runs the same code the plugin runs (including [your own rules](rules.md)),
against the real filesystem, without executing anything.

Make `bashlight` a command so you do not repeat the `bunx` prefix:

```bash
alias bashlight='bunx --package github:OffworldNexus/bashlight bashlight'
```

After the npm release, `bunx bashlight` is enough.

## 4. Watch it while you work

Once OpenCode is running, `bashlight watch` follows the audit log and prints one block
per shell call:

```console
$ bashlight watch --since 10m
2026-11-08 15:12:04  ses_1234  ~/dev/shop
  - pip install requests
  + poetry add requests
  rules: pip-to-manager  reasons: install with the project manager
```

Nothing it rewrites is hidden from you, only from the agent. See
[monitoring](monitoring.md) for `watch`, `stats`, `explain`, `rules` and `doctor`.

## Options

Options are the `{ package, options }` form of a `plugins` entry:

```json title="~/.config/opencode/opencode.json"
{
    "plugins": [
        {
            "package": "github:OffworldNexus/bashlight",
            "options": {
                "auditLog": false,
                "disabledRules": ["node-manager"],
                "customRules": false
            }
        }
    ]
}
```

| Option          | Default                                                                             | Meaning                                                                                    |
| --------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `auditLog`      | `$XDG_DATA_HOME/bashlight/audit.jsonl`, else `~/.local/share/bashlight/audit.jsonl` | A path to write the [audit log](monitoring.md#the-audit-log) to, or `false` to disable it. |
| `disabledRules` | `[]`                                                                                | [Rule](rules.md) ids not to apply, built-in or custom, for example `["node-manager"]`.     |
| `customRules`   | `true`                                                                              | `false` disables [your own rules](rules.md#your-own-rules) entirely (project and global).  |

A malformed option is ignored rather than fatal: an unknown type falls back to the
default, and an unknown rule id simply matches nothing.

### Your own rules and trust

Custom rules are optional and need no clone; see
[Your own rules](rules.md#your-own-rules). A rule file is code that runs with your full
privileges, so `~/.config/opencode/bashlight/rules/` is always loaded but a project's
`.opencode/bashlight/rules/` is only loaded once you run:

```console
$ bashlight trust ~/dev/shop
```

`bashlight rules` and `bashlight doctor` tell you when project rules are being skipped,
and `bashlight untrust ~/dev/shop` stops loading them again.

## Updating

OpenCode manages package plugins itself — you edit `opencode.json`, never a
`node_modules` folder.

A **git** spec is _mutable_ unless it names a full commit, so OpenCode checks the
installed revision against the remote when it starts and about once a day, and shows the
plugin as out of date when the branch moved; applying that update installs the new
revision and reloads it. To follow `develop`, keep the branch (or drop the ref
entirely):

```json
{ "plugins": ["github:OffworldNexus/bashlight#develop"] }
```

To pin an exact commit instead, use its full 40-character SHA — OpenCode then never
considers it out of date:

```json
{ "plugins": ["github:OffworldNexus/bashlight#<full-commit-sha>"] }
```

The same rule applies once bashlight is on npm: `"bashlight"` tracks the latest release,
while `"bashlight@0.1.0"` is pinned.

## Uninstall

Remove the bashlight entry from `plugins` and restart OpenCode. The audit log at
`~/.local/share/bashlight/audit.jsonl` is left behind — delete it if you want a clean
slate, and `~/.config/opencode/bashlight/rules/` if you wrote global
[custom rules](rules.md#your-own-rules). OpenCode's own npm cache keeps a copy of the
package; it is cleaned up automatically.

## Where next

- [How it works](how-it-works.md) — what happens between the agent's command and the one
  that runs.
- [Rules](rules.md) — what the built-in rules do, and how to add one without a clone.
