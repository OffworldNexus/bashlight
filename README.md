# bashlight

**The agent thinks it ran its command. bashlight made it run the right one.**

bashlight gaslights coding agents, starting with bash. It sits between an LLM agent and
the shell and silently rewrites the bash the agent runs to match the project's
conventions. When an agent runs `pip install requests` in a Poetry project, bashlight
turns the call into `poetry add requests` and lets the agent believe that is what it did
— no instructions in the prompt, no denials, no retries. It never executes anything to
decide: it parses the command, pre-interprets it statically (variables, `cd`, `bash -c`,
ssh, wrappers…), runs a set of rules on every command that would execute, edits the
source minimally, and re-interprets the result to prove the edit did exactly what it
meant. When anything is uncertain, it fails open and the original command runs
untouched.

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

1. Clone it and install the one runtime dependency:

    ```console
    $ git clone https://github.com/OffworldNexus/bashlight ~/dev/bashlight
    $ cd ~/dev/bashlight && bun install
    ```

2. Point OpenCode at the plugin. Drop a one-line file into the project (or into
   `~/.config/opencode/plugins/` to enable it everywhere), with the absolute path to the
   checkout:

    ```ts title=".opencode/plugins/bashlight.ts"
    export { default } from "/home/user/dev/bashlight/src/opencode/plugin.ts";
    ```

3. Check it is live:

    ```console
    $ bun bin/bashlight doctor
    ```

## Keep an eye on it

bashlight hides itself from the agent, not from you. A small CLI reads the audit log it
writes and dry-runs the pipeline:

- `watch` — follow the audit log in real time, one block per rewrite.
- `stats` — totals, per-rule counts and the most common rewrites over a window.
- `explain` — dry-run one command and show exactly what would run.
- `doctor` — check the runtime, the plugin and the pipeline end to end.

```console
$ bun bin/bashlight watch --since 10m
2026-11-08 15:12:04  ses_1234  ~/dev/shop
  - pip install requests
  + poetry add requests
  rules: pip-to-manager  reasons: install with the project manager
```

## Documentation

**Read the docs →** <https://offworldnexus.github.io/bashlight/>

[Getting started](https://offworldnexus.github.io/bashlight/getting-started/) ·
[How it works](https://offworldnexus.github.io/bashlight/how-it-works/) ·
[Rules](https://offworldnexus.github.io/bashlight/rules/) ·
[Monitoring](https://offworldnexus.github.io/bashlight/monitoring/) ·
[Benchmark](https://offworldnexus.github.io/bashlight/benchmark/)

## Development

```console
$ make clean   # prettier + eslint + tsc
$ bun test     # the test suite
```

`tests/cases/` holds hand-written end-to-end examples; `corpus/` is an optional, private
git submodule of anonymized real commands. The corpus tests are skipped when the
submodule is absent, as on CI, so `bun test` works on a bare clone.

## License

Apache 2.0 — see [`LICENSE`](LICENSE).
