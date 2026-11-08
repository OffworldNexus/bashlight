# bashlight benchmark

A reproducible task benchmark for bashlight. It runs multi-step fake projects through
OpenCode headlessly, once **with** the bashlight plugin and once **without**, on a few
cheap models, and records success, tokens, cost, wall time and shell activity. The
results drive the charts on the [benchmark page](../docs/benchmark.md).

## Layout

```
bench/
  run.ts            matrix runner (bun bench/run.ts)
  report.ts         results -> RESULTS.md + HEADLINES.json + charts (bun bench/report.ts)
  charts.ts         SVG headline-chart generation (bun bench/charts.ts)
  tasks.ts          the projects, their prompts and success checkers
  lib/              the harness (pure parsing/aggregation + thin adapters)
  projects/         committed project templates (source and lockfiles only)
  results/          one JSON line per run (committed; small and useful)
  runs/             raw event logs per run (gitignored)
  charts/           exploratory charts from --all-charts (gitignored)
  .cache/           shared package-manager caches (gitignored)
```

Working copies are created fresh under `/tmp/opencode/bench-runs/<run-id>/`, so the
benchmark never mutates a template and never shares state between runs.

Only **matched cells** are compared: a (project, model) cell counts when it has a
completed run in _both_ modes, and each cell is weighted once. Unmatched runs are listed
but never compared.

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
bun bench/report.ts                    # newest results -> RESULTS.md + HEADLINES.json + charts
bun bench/report.ts --all              # merge every results file, then render
bun bench/report.ts --all-charts       # also write the exploratory charts to bench/charts/
```

Flags: `--models a,b`, `--modes with,without`, `--projects all|a,b`, `--repeat N`,
`--jobs N` (parallel runs, default 3), `--timeout SECONDS`, `--max-cost USD`,
`--min-free-gb N`, `--keep-runs`, `--dry-run`. The report takes `--all` (merge all
files) and `--all-charts`.

After each run the working copy is **pruned**: the `.venv` / `node_modules`, the per-run
cache and the session database are deleted, keeping only the transcript, the audit log,
the OpenCode log, the checker output and a capped project-vs-template diff in
`bench/runs/<id>/`. `--keep-runs` disables pruning for debugging. Package-manager caches
are shared under `bench/.cache` (uv, poetry, pip, npm, pnpm store), never per run;
before each run the runner stops cleanly if free space on the run root drops below
`--min-free-gb` (default 2). A run that fails for an environment reason (out of disk,
spawn error, harness timeout) is recorded as a harness error and excluded from every
statistic.

The runner runs up to `--jobs` isolated cells at once. Before starting another it asks a
cost guard whether `spend + mean(completed) × (in flight + 1)` would cross `--max-cost`,
so a parallel matrix still respects the cap.

## Models and tiers

Models live in `lib/models.ts`, each with a **tier** and a display name:

- `small` — a cheap, fast mini/nano model (`openai/gpt-5-nano`).
- `flash` — a cheap-but-capable flash model (`deepseek/deepseek-v4.1-flash`,
  `anthropic/claude-haiku-5.5`).

The cost/time headline covers the `flash` tier; the completion chart lists every model
smallest first (ordered by output price). To add a model, append an entry with its id,
display name, tier and `outputPricePerMTok` (keep the price in sync with OpenRouter); an
unknown model falls back to `flash` and orders last.

## Metrics

Each run records: success (from the checker), cost, input/output tokens, wall time,
total shell calls, failed shell calls (non-zero exit or tool error), bashlight rewrites
and blocks (from the run's audit log), and the time to the last passing test command
("green"). The report aggregates them by cell, model × mode and project × mode,
equal-weighted over matched cells.

## Charts

`bench/charts.ts` renders two dependency-free headline SVGs into
`docs/assets/benchmark/`: `headline-cost-time.svg` (flash-class paired median change in
cost and wall time, with a min–max whisker across cells) and `headline-completion.svg`
(completion with vs without, models smallest first). `bench/report.ts` also writes
`bench/HEADLINES.json` with the exact numbers behind both messages. The exploratory
charts are still buildable, off the docs page, with `--all-charts` (into
`bench/charts/`). The renderer's scale and layout maths live in `bench/lib/chart.ts` and
are unit-tested.

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
