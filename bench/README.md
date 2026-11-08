# bashlight benchmark

A small, reproducible task benchmark for bashlight. It runs a handful of fake projects
through OpenCode headlessly, once **with** the bashlight plugin and once **without**, on
a few cheap models, and records success, tokens, cost, wall time and shell activity.

## Layout

```
bench/
  run.ts            matrix runner (bun bench/run.ts)
  report.ts         results.jsonl -> RESULTS.md (bun bench/report.ts)
  tasks.ts          the projects, their prompts and success checkers
  lib/              the harness (pure parsing/aggregation + thin adapters)
  projects/         committed project templates (source and lockfiles only)
  results/          one JSON line per run (committed; small and useful)
  runs/             raw event logs per run (gitignored)
  .cache/           shared package-manager caches (gitignored)
```

Working copies of each project are created fresh under
`/tmp/opencode/bench-runs/<run-id>/`, so the benchmark never mutates a template and
never shares state between runs.

## Projects and tasks

| Project       | Stack           | Task                                                                 |
| ------------- | --------------- | -------------------------------------------------------------------- |
| `poetry-shop` | Poetry + pytest | add a `slugify_title` helper using `python-slugify`, with tests      |
| `uv-report`   | uv + pytest     | add a `report` command that renders `data.csv` with `tabulate`       |
| `pnpm-web`    | pnpm + vitest   | add a `formatRelative` util using `dayjs` (relativeTime), with tests |

Each task's success checker runs the project's own test command _and_ verifies the new
dependency is declared, so an agent cannot pass by "vendoring" the code.

## Running

```sh
bun bench/run.ts                       # full default matrix
bun bench/run.ts --dry-run             # print the matrix, run nothing
bun bench/run.ts --projects poetry-shop --modes with \
  --models openrouter/deepseek/deepseek-v4.1-flash
bun bench/run.ts --max-cost 1          # stop before crossing a projected $1
bun bench/report.ts                    # newest results -> bench/RESULTS.md
```

Flags: `--models a,b`, `--modes with,without`, `--projects all|a,b`, `--repeat N`,
`--timeout SECONDS`, `--max-cost USD`, `--dry-run`.

The default models are three cheap, tool-capable models from three families:
`openrouter/deepseek/deepseek-v4.1-flash`, `openrouter/openai/gpt-5-nano` and
`openrouter/qwen/qwen3-coder-30b-a3b-instruct`.

## Isolation

Every run gets its own XDG tree and `HOME` under the run directory, and a minimal
`opencode.json` with no MCP servers and no plugins (except bashlight in `with` mode).
The child environment is assembled from a small allowlist, so the user's OpenCode
config, plugins, MCP servers, `AGENTS.md` and session database cannot leak in. The
OpenRouter key is read at runtime from the user's OpenCode auth store (`auth.json`, or
`OPENROUTER_API_KEY`) and passed to the child only through its environment: it is never
written to disk or logged.

bashlight audits shell calls to `$XDG_DATA_HOME/bashlight/audit.jsonl`, which is inside
the isolated tree, so each run's rewrites and blocks are attributed exactly.

## Credentials

`bun bench/run.ts` needs an OpenRouter key. It prefers `OPENROUTER_API_KEY` and
otherwise reads the `openrouter` entry from `$XDG_DATA_HOME/opencode/auth.json` (falling
back to `$HOME/.local/share/opencode/auth.json`).
