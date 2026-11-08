# bashlight benchmark

A reproducible task benchmark for bashlight. It runs multi-step fake projects through
OpenCode headlessly, once **with** the bashlight plugin and once **without**, on a few
cheap models, and records success, tokens, cost, wall time and shell activity. The
results drive the charts on the [benchmark page](../docs/benchmark.md).

## Layout

```
bench/
  run.ts            matrix runner (bun bench/run.ts)
  report.ts         results -> RESULTS.md + charts (bun bench/report.ts)
  charts.ts         SVG chart generation (bun bench/charts.ts)
  tasks.ts          the projects, their prompts and success checkers
  lib/              the harness (pure parsing/aggregation + thin adapters)
  projects/         committed project templates (source and lockfiles only)
  results/          one JSON line per run (committed; small and useful)
  runs/             raw event logs per run (gitignored)
  .cache/           shared package-manager caches (gitignored)
```

Working copies are created fresh under `/tmp/opencode/bench-runs/<run-id>/`, so the
benchmark never mutates a template and never shares state between runs.

## Projects and tasks

| Project              | Stack                | Task                                                             |
| -------------------- | -------------------- | ---------------------------------------------------------------- |
| `monorepo`           | Poetry + pnpm        | API slug helper and web validator, both suites green             |
| `uv-cli`             | uv + ruff + mypy     | two subcommands; tests, lint and types must pass                 |
| `poetry-django-lite` | Poetry + `manage.py` | a `report` command that reads YAML and writes a CSV, then run it |
| `scripts`            | none                 | convert `data.yaml` to `data.csv` with a kept Python script      |
| `pnpm-web`           | pnpm + vitest        | dayjs util and zod validator; tests, `tsc` and eslint must pass  |

The prompts never name the toolchain. Each checker runs the project's own commands and
verifies the new dependency is declared, so an agent cannot pass by "vendoring" the
code.

## Running

```sh
bun bench/run.ts                       # full default matrix (5×2×3, --jobs 3)
bun bench/run.ts --dry-run             # print the matrix, run nothing
bun bench/run.ts --projects scripts --modes without \
  --models openrouter/deepseek/deepseek-v4.1-flash
bun bench/run.ts --repeat 3 --jobs 3 --max-cost 5
bun bench/report.ts                    # newest results -> RESULTS.md + charts
bun bench/report.ts --all              # merge every results file, then render
```

Flags: `--models a,b`, `--modes with,without`, `--projects all|a,b`, `--repeat N`,
`--jobs N` (parallel runs, default 3), `--timeout SECONDS`, `--max-cost USD`,
`--dry-run`.

The runner runs up to `--jobs` isolated cells at once. Before starting another it asks a
cost guard whether `spend + mean(completed) × (in flight + 1)` would cross `--max-cost`,
so a parallel matrix still respects the cap.

The default models are three cheap, tool-capable models from three families:
`openrouter/deepseek/deepseek-v4.1-flash`, `openrouter/openai/gpt-5-nano` and
`openrouter/anthropic/claude-haiku-5.5`.

## Metrics

Each run records: success (from the checker), cost, input/output tokens, wall time,
total shell calls, failed shell calls (non-zero exit or tool error), bashlight rewrites
and blocks (from the run's audit log), and the time to the last passing test command
("green"). `bench/report.ts` aggregates them by model × mode and by project × mode.

## Charts

`bench/charts.ts` renders five dependency-free SVGs into `docs/assets/benchmark/`:
success, cost, wall time and failed shell calls by model, plus a per-project
success/cost chart. They use a transparent background and mid-contrast colours that read
on both light and dark pages. The renderer's scale and layout maths live in
`bench/lib/chart.ts` and are unit-tested.

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
