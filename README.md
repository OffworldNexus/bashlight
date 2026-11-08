# bashlight

**bashlight gaslights your coding agent.** It sits between an LLM and the shell and
silently rewrites the bash the agent runs so it matches the project's conventions. The
agent keeps seeing its own command; the project gets the right one. It is deliberate and
benign: the agent ends up doing what it meant, the way the project wants.

## The idea, in four steps

1. **Detect the intent** of the LLM's tool call — what it is trying to do: install a
   dependency, run the tests, run a script…
2. **Figure out how to actually do it for the project at hand** — its package manager,
   runner, virtualenv, conventions — read from the working directory at that exact
   command.
3. **Fix the call** — rewrite the command minimally, re-parse it to prove the edit did
   exactly what it meant, and fail open when unsure.
4. **Make the LLM believe it was its own idea** — the agent keeps seeing its original
   command in its history. No instructions in the prompt, no denials, no retries.

Nothing is executed to decide: bashlight parses the command, pre-interprets it
statically (variables, `cd`, `bash -c`, ssh, wrappers…) and finds every command that
would run. When anything is uncertain, the original command runs untouched.

## Before → after

| Project | The agent runs                           | What runs                                     |
| ------- | ---------------------------------------- | --------------------------------------------- |
| Poetry  | `pip install -U requests`                | `poetry add requests@latest`                  |
| Poetry  | `P="python"; $P main.py`                 | `P="poetry run python"; $P main.py`           |
| uv      | `cd api && python main.py`               | `cd api && uv run python main.py`             |
| pnpm    | `npm i -D vitest`                        | `pnpm add -D vitest`                          |
| Poetry  | `./manage.py migrate`                    | `poetry run ./manage.py migrate`              |
| Poetry  | `bash -c 'python manage.py check'`       | `bash -c 'poetry run python manage.py check'` |
| uv      | `poetry run python manage.py check`      | `uv run python manage.py check`               |
| —       | `pip install requests` outside a project | _blocked_, pointing at PEP 723 scripts        |

## Install

bashlight is **unreleased**; install it from GitHub for now. Add it to the `plugins`
array of `opencode.json` — the project's, or `~/.config/opencode/opencode.json` to
enable it everywhere:

```json
{
    "plugins": ["github:OffworldNexus/bashlight"]
}
```

Restart OpenCode. That is all: no clone, no `bun install`, no plugin file to write. Once
it is published to npm, the entry becomes `"plugins": ["bashlight"]`.

## Try it before trusting it

The CLI runs the same pipeline as the plugin and reads the audit log it writes. Run it
without installing anything:

```console
$ bunx --package github:OffworldNexus/bashlight bashlight doctor
```

Or make it a command:

```console
$ alias bashlight='bunx --package github:OffworldNexus/bashlight bashlight'
$ bashlight explain 'pip install requests' --cwd ~/dev/shop
rewritten:
  - pip install requests
  + poetry add requests
changes:
  - rules: pip-to-manager  reasons: install with the project manager
      pip install requests → poetry add requests
```

`watch` follows the audit log in real time, `stats` summarises it, `rules` lists the
rules in effect (built-in and yours), `doctor` checks the whole installation. After the
npm release, `bunx bashlight doctor` is enough.

## Documentation

**Read the docs →** <https://offworldnexus.github.io/bashlight/>

[Getting started](https://offworldnexus.github.io/bashlight/getting-started/) ·
[How it works](https://offworldnexus.github.io/bashlight/how-it-works/) ·
[Rules](https://offworldnexus.github.io/bashlight/rules/) ·
[Monitoring](https://offworldnexus.github.io/bashlight/monitoring/) ·
[Benchmark](https://offworldnexus.github.io/bashlight/benchmark/)

## Contributing

You only need a checkout to work _on_ bashlight.

```console
$ git clone https://github.com/OffworldNexus/bashlight ~/dev/bashlight
$ cd ~/dev/bashlight && bun install
$ make clean   # prettier + eslint + tsc
$ bun test     # the test suite
```

This repo enables the working tree for itself through the one-line
`.opencode/plugins/bashlight.ts` re-export — a contributor convenience, not the install
story. `tests/cases/` holds hand-written end-to-end examples; `corpus/` is an optional,
private git submodule of anonymized real commands and its tests are skipped when it is
absent, so `bun test` works on a bare clone. See
[docs/contributing.md](docs/contributing.md) for the release checklist.

## License

Apache 2.0 — see [`LICENSE`](LICENSE).
