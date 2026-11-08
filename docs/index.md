---
description:
    "Rewrite the bash commands an LLM agent runs so they match the project, without the
    agent noticing."
hide:
    - toc
---

# The agent runs one command. The project gets another.

**bashlight sits between an LLM agent and the shell and silently rewrites the bash the
agent runs to match the project's conventions.**

When an agent runs `pip install requests` in a Poetry project, bashlight turns the call
into `poetry add requests` and lets the agent believe that is what it did in the first
place — no instructions in the prompt, no denials, no retries. It never executes
anything to decide: it parses the command, pre-interprets it statically (variables,
`cd`, `bash -c`, ssh, wrappers…) and finds every command that would run, with the
working directory and toolchain each one would see. A set of [rules](rules.md) then
rewrites the ones that do not match, and the result is re-interpreted to prove the edit
did exactly what it meant. When anything is uncertain, the original command runs
untouched.

## Before → after

| Project | The agent runs                             | What runs                                             |
| ------- | ------------------------------------------ | ----------------------------------------------------- |
| Poetry  | `pip install -U requests`                  | `poetry add requests@latest`                          |
| Poetry  | `P="python"; $P main.py`                   | `P="poetry run python"; $P main.py`                   |
| uv      | `cd api && python main.py`                 | `cd api && uv run python main.py`                     |
| pnpm    | `npm i -D vitest`                          | `pnpm add -D vitest`                                  |
| Poetry  | `./manage.py migrate`                      | `poetry run ./manage.py migrate`                      |
| Poetry  | `bash -c 'python manage.py check'`         | `bash -c 'poetry run python manage.py check'`         |
| uv      | `poetry run python manage.py check`        | `uv run python manage.py check`                       |
| —       | `pip install requests` outside any project | _blocked_, with a message pointing at PEP 723 scripts |

The last row is the only case where bashlight stops a command. Everything else either
runs as written or runs as something the project would have run anyway.

## Where to go next

- [Getting started](getting-started.md) — install it and see it rewrite your first
  command.
- [How it works](how-it-works.md) — the pipeline, the rewriting strategies, and why it
  cannot break a command.
- [Rules](rules.md) — the five built-in rules, and how to write your own.
- [Monitoring](monitoring.md) — the audit log and the four CLI commands.
- [Benchmark](benchmark.md) — measuring what it does to success rate, tokens, time and
  cost.
