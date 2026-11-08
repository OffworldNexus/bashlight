# Getting started

Install bashlight once, point OpenCode at it, and watch it rewrite a command before you
trust it with a session.

## Requirements

- **Bun** 1.3 or newer — bashlight is TypeScript run by Bun, not compiled.
- **OpenCode** v2.2 or newer — the plugin targets `@opencode/plugin` ≥ 2.2.
- A project whose conventions you want enforced: Poetry, uv, pipenv, PDM or a bare venv
  for Python; npm, pnpm, yarn or Bun for Node.

## 1. Clone and install

```console
$ git clone https://github.com/OffworldNexus/bashlight ~/dev/bashlight
$ cd ~/dev/bashlight && bun install
```

`bun install` pulls the one runtime dependency, `@opencode/plugin`, and the build-time
tooling.

## 2. Point OpenCode at it

A plugin file is a one-liner that re-exports bashlight's entry point. Put it in the
project (so the project carries its own conventions)…

```ts title=".opencode/plugins/bashlight.ts"
export { default } from "/home/user/dev/bashlight/src/opencode/plugin.ts";
```

…or in your OpenCode config directory (so every project gets it):

```ts title="~/.config/opencode/plugins/bashlight.ts"
export { default } from "/home/user/dev/bashlight/src/opencode/plugin.ts";
```

Both are the same content; only the directory differs. The path inside the export must
be absolute.

!!! note "A third option: `opencode.json`"

    You can also list bashlight in the `plugins` array of
    `~/.config/opencode/opencode.json`. That form is what lets you pass
    [options](#options).

## 3. Check that it is live

`bashlight doctor` reads your environment and runs the pipeline end to end without
touching a project:

```console
$ bun bin/bashlight doctor
✓ bun 1.3.14
✓ opencode opencode v2.2.5
✓ plugin discoverability (project: /home/user/dev/shop/.opencode/plugins/bashlight.ts)
✓ audit log /home/user/.local/share/bashlight/audit.jsonl (2.1 kB, last entry 2026-11-08T15:12:04.117Z)
✓ self-test: pip install requests → poetry add requests
```

`✗` is a failure (exit code 1), `⚠` a warning. The one warning worth reading is
`audit log is idle`: it means no shell call has gone through in the last day, which
usually means the plugin is not loaded — see
[monitoring](monitoring.md#troubleshooting).

Then ask it what it would do to a real command, in a real directory:

```console
$ bun bin/bashlight explain 'pip install requests' --cwd ~/dev/shop
rewritten:
  - pip install requests
  + poetry add requests
changes:
  - rules: pip-to-manager  reasons: install with the project manager
      pip install requests → poetry add requests
```

`explain` runs the real pipeline against the real filesystem with your current
environment. It is the honest answer to "what will bashlight do here?", because it is
the same code that runs in the plugin.

## Options

Options come from the `plugins` array of `opencode.json`, as `{ package, options }`:

```json title="~/.config/opencode/opencode.json"
{
    "plugins": [
        {
            "package": "/home/user/dev/bashlight/src/opencode/plugin.ts",
            "options": {
                "auditLog": false,
                "disabledRules": ["node-manager"]
            }
        }
    ]
}
```

| Option          | Default                                                                             | Meaning                                                                                    |
| --------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `auditLog`      | `$XDG_DATA_HOME/bashlight/audit.jsonl`, else `~/.local/share/bashlight/audit.jsonl` | A path to write the [audit log](monitoring.md#the-audit-log) to, or `false` to disable it. |
| `disabledRules` | `[]`                                                                                | [Rule](rules.md) ids not to apply, for example `["node-manager"]`.                         |

A malformed option is ignored rather than fatal: an unknown type falls back to the
default, and an unknown rule id simply matches nothing.

## Where next

- [How it works](how-it-works.md) — what happens between the agent's command and the one
  that runs.
- [Rules](rules.md) — what the built-in rules do, and how to add one.
