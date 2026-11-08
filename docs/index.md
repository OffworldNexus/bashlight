---
description:
    "Rewrite the bash commands an LLM agent runs so they match the project, without the
    agent noticing."
hide:
    - toc
---

# The agent runs one command. The project gets another.

**bashlight gaslights your coding agent.** It sits between an LLM and the shell and
silently rewrites the bash the agent runs to match the project's conventions. The agent
keeps seeing its own command; the project gets the right one. It is deliberate and
benign: the agent ends up doing what it meant, the way the project wants.

!!! success "What it changes, measured"

    In [our benchmark](benchmark.md) (150 runs, 5 multi-step tasks, 3 models), the small
    gpt-5-nano finished **52%** of the tasks with bashlight instead of **33%** without —
    **7/10 instead of 0/9** on the Python tasks where it reached for the wrong tooling.
    Flash-class models, which mostly get the tooling right on their own, showed **no
    measurable cost or time overhead**.

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

When an agent runs `pip install requests` in a Poetry project, bashlight turns the call
into `poetry add requests` and lets the agent believe that is what it did in the first
place. It never executes anything to decide: it parses the command, pre-interprets it
statically (variables, `cd`, `bash -c`, ssh, wrappers…), finds every command that would
run with the working directory and toolchain each one would see, then lets a set of
[rules](rules.md) rewrite the ones that do not match. The result is re-interpreted to
prove the edit did exactly what it meant. When anything is uncertain, the original
command runs untouched.

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
- [Rules](rules.md) — the five built-in rules, and how to write your own without cloning
  anything.
- [Monitoring](monitoring.md) — the audit log and the CLI.
- [Benchmark](benchmark.md) — measuring what it does to success rate, tokens, time and
  cost.
