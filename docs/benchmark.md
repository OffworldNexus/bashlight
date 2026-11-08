# Benchmark

Does bashlight help an agent finish its work, or does it only make the transcript look
tidier? The benchmark in
[`bench/`](https://github.com/OffworldNexus/bashlight/tree/develop/bench) measures it on
three small fake projects, each with one realistic task and an objective success check:

| Project       | Toolchain     | Task                                                      | Success means                                        |
| ------------- | ------------- | --------------------------------------------------------- | ---------------------------------------------------- |
| `poetry-shop` | Poetry/pytest | add `slugify_title()` using python-slugify, with tests    | `poetry run pytest` passes, dependency declared      |
| `uv-report`   | uv/pytest     | add a `report` CLI command printing a table with tabulate | `uv run pytest` passes, dependency declared          |
| `pnpm-web`    | pnpm/vitest   | add `formatRelative()` using dayjs, with tests            | `pnpm test` passes, dependency declared, no npm lock |

Each task runs headless (`opencode run --format json`) in a fresh copy of the project,
once **with** the plugin and once **without**, on three cheap models, twice each. Every
run uses an isolated OpenCode configuration (no MCP servers, no personal instructions,
no other plugins) so the only difference between the two modes is bashlight.

## Results

36 runs, $0.70 in total.

| Model               | Mode    | Success | Input tokens | Output tokens |  Cost | Wall (s) | Failed shell calls | Rewrites |
| ------------------- | ------- | ------: | -----------: | ------------: | ----: | -------: | -----------------: | -------: |
| deepseek-v4.1-flash | without |    100% |       29 309 |         4 749 | 0.97¢ |     33.3 |                0.3 |        — |
| deepseek-v4.1-flash | with    |    100% |       26 923 |         3 428 | 0.73¢ |     26.5 |                0.0 |      0.2 |
| gpt-5-nano          | without |     67% |        6 816 |         5 266 | 0.34¢ |     55.7 |                2.0 |        — |
| gpt-5-nano          | with    |     50% |        4 960 |         4 953 | 0.31¢ |     44.8 |                1.7 |      0.7 |
| qwen3-coder-30b-a3b | without |      0% |      346 889 |         4 757 | 5.49¢ |     44.3 |                5.0 |        — |
| qwen3-coder-30b-a3b | with    |     17% |      240 136 |         3 615 | 3.82¢ |     37.8 |                4.3 |      2.8 |

All values except success are per-run means (6 runs per row).

## Reading it

- **Cheaper and faster.** With the plugin, every model used fewer tokens: cost per run
  dropped by 25% (deepseek), 9% (gpt-5-nano) and 30% (qwen), and wall time by 15–20%.
  Fewer shell calls failed, because `pytest`, `python` and `npx` ran in the right
  environment the first time instead of erroring and being retried.
- **Success rates are dominated by the models.** deepseek solves everything either way;
  qwen mostly fails to install the dependency at all. The gpt-5-nano difference is a
  single run out of six, and in the failing "with" runs the audit log shows the plugin
  either did nothing or rewrote `pytest` to `poetry run pytest` correctly — the model
  then stopped without adding the library.
- **Small sample.** Two repetitions per cell is enough to see the cost and time trend,
  not to measure success-rate effects precisely. The tasks are also easy: capable models
  often run `poetry add` or `uv run` by themselves, so bashlight rewrote only a handful
  of commands per run.

## Running it

```console
$ bun bench/run.ts --repeat 2 --max-cost 2     # the full matrix, capped at $2
$ bun bench/report.ts                          # regenerate bench/RESULTS.md
```

The runner reads the OpenRouter key from your OpenCode credentials, passes it only to
the child process, and stops before a run whose projected cost would exceed
`--max-cost`. See
[`bench/README.md`](https://github.com/OffworldNexus/bashlight/blob/develop/bench/README.md)
for the details.
