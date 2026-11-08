# bashlight benchmark results

Matched cells: 15 · Runs: 149 · Success: 121/149 · Total cost: $1.0732

Only matched cells count: a cell is included when it has a completed run in both modes.

Every column except `Cells` and `Runs` is an equal-weight mean over cells.

## By cell (project × model)

| Project            | Model               | Runs w/o | Runs with | Success w/o | Success with | Δ cost | Δ time |
| ------------------ | ------------------- | -------: | --------: | ----------: | -----------: | -----: | -----: |
| monorepo           | claude-haiku-5.5    |        5 |         5 |        100% |         100% |   −14% |   −11% |
| monorepo           | deepseek-v4.1-flash |        5 |         5 |        100% |         100% |    −7% |    +0% |
| monorepo           | gpt-5-nano          |        5 |         5 |          0% |           0% |   +34% |   +18% |
| pnpm-web           | claude-haiku-5.5    |        5 |         5 |        100% |         100% |    −4% |    +1% |
| pnpm-web           | deepseek-v4.1-flash |        5 |         5 |        100% |         100% |   +52% |   +24% |
| pnpm-web           | gpt-5-nano          |        5 |         5 |         60% |          20% |   −11% |    −7% |
| poetry-django-lite | claude-haiku-5.5    |        5 |         5 |        100% |         100% |    −3% |    +1% |
| poetry-django-lite | deepseek-v4.1-flash |        5 |         5 |        100% |         100% |    −8% |    −6% |
| poetry-django-lite | gpt-5-nano          |        4 |         5 |          0% |          60% |   +23% |    +3% |
| scripts            | claude-haiku-5.5    |        5 |         5 |        100% |         100% |    +1% |    −5% |
| scripts            | deepseek-v4.1-flash |        5 |         5 |        100% |         100% |    −5% |   −12% |
| scripts            | gpt-5-nano          |        5 |         5 |        100% |         100% |   +17% |   +15% |
| uv-cli             | claude-haiku-5.5    |        5 |         5 |        100% |         100% |   −22% |    −4% |
| uv-cli             | deepseek-v4.1-flash |        5 |         5 |        100% |         100% |    +9% |   +15% |
| uv-cli             | gpt-5-nano          |        5 |         5 |          0% |          80% |   +26% |    +6% |

## By model

| Model                                   | Mode    | Cells | Runs | Success | In tok | Out tok |    Cost | Wall (s) | Shell | Shell fail | Rewrites | Green (s) |
| --------------------------------------- | ------- | ----: | ---: | ------: | -----: | ------: | ------: | -------: | ----: | ---------: | -------: | --------: |
| openrouter/anthropic/claude-haiku-5.5   | without |     5 |   25 |    100% |     20 |    4690 | $0.0056 |     27.7 |   6.2 |        0.2 |      0.0 |      21.2 |
| openrouter/anthropic/claude-haiku-5.5   | with    |     5 |   25 |    100% |     21 |    4281 | $0.0049 |     26.6 |   6.0 |        0.2 |      1.0 |      20.5 |
| openrouter/deepseek/deepseek-v4.1-flash | without |     5 |   25 |    100% |  32297 |    5481 | $0.0102 |     31.4 |   9.6 |        0.4 |      0.0 |      25.3 |
| openrouter/deepseek/deepseek-v4.1-flash | with    |     5 |   25 |    100% |  35475 |    6099 | $0.0109 |     33.3 |   9.6 |        0.3 |      0.8 |      28.2 |
| openrouter/openai/gpt-5-nano            | without |     5 |   24 |     32% |   8719 |    7457 | $0.0053 |     80.8 |   8.5 |        3.0 |      0.0 |      13.4 |
| openrouter/openai/gpt-5-nano            | with    |     5 |   25 |     52% |   9521 |    8167 | $0.0063 |     86.5 |  10.0 |        2.8 |      2.4 |      38.6 |

## By project

| Project            | Mode    | Cells | Runs | Success |    Cost | Wall (s) | Shell fail | Rewrites | Green (s) |
| ------------------ | ------- | ----: | ---: | ------: | ------: | -------: | ---------: | -------: | --------: |
| monorepo           | without |     3 |   15 |     67% | $0.0105 |     71.6 |        0.9 |      0.0 |      25.7 |
| monorepo           | with    |     3 |   15 |     67% | $0.0107 |     77.8 |        1.8 |      1.4 |      45.5 |
| pnpm-web           | without |     3 |   15 |     87% | $0.0064 |     48.6 |        1.2 |      0.0 |      31.8 |
| pnpm-web           | with    |     3 |   15 |     73% | $0.0074 |     48.6 |        0.4 |      0.0 |      20.6 |
| poetry-django-lite | without |     3 |   14 |     67% | $0.0070 |     46.1 |        2.0 |      0.0 |      17.2 |
| poetry-django-lite | with    |     3 |   15 |     87% | $0.0070 |     46.4 |        1.9 |      2.1 |      35.9 |
| scripts            | without |     3 |   15 |    100% | $0.0024 |     17.4 |        0.5 |      0.0 |       0.0 |
| scripts            | with    |     3 |   15 |    100% | $0.0024 |     18.6 |        0.3 |      1.5 |       0.0 |
| uv-cli             | without |     3 |   15 |     67% | $0.0089 |     49.5 |        1.5 |      0.0 |      25.2 |
| uv-cli             | with    |     3 |   15 |     93% | $0.0092 |     52.7 |        1.2 |      1.9 |      43.6 |

## Harness errors (excluded)

1 run(s) failed for harness/environment reasons and are excluded from every statistic.

| Project            | Model                        | Mode    | Run ID                                                                      | Error     |
| ------------------ | ---------------------------- | ------- | --------------------------------------------------------------------------- | --------- |
| poetry-django-lite | openrouter/openai/gpt-5-nano | without | 20261108T183321Z-poetry-django-lite-without-openrouter-openai-gpt-5-nano-r4 | timed out |
