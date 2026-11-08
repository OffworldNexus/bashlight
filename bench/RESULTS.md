# bashlight benchmark results

Matched cells: 1 · Runs: 2 · Success: 2/2 · Total cost: $0.0110

Only matched cells count: a cell is included when it has a completed run in both modes.

Every column except `Cells` and `Runs` is an equal-weight mean over cells.

## By cell (project × model)

| Project | Model               | Runs w/o | Runs with | Success w/o | Success with | Δ cost | Δ time |
| ------- | ------------------- | -------: | --------: | ----------: | -----------: | -----: | -----: |
| scripts | deepseek-v4.1-flash |        1 |         1 |        100% |         100% |   +48% |   +39% |

## By model

| Model                                   | Mode    | Cells | Runs | Success | In tok | Out tok |    Cost | Wall (s) | Shell | Shell fail | Rewrites | Green (s) |
| --------------------------------------- | ------- | ----: | ---: | ------: | -----: | ------: | ------: | -------: | ----: | ---------: | -------: | --------: |
| openrouter/deepseek/deepseek-v4.1-flash | without |     1 |    1 |    100% |  17227 |     543 | $0.0045 |      8.0 |   2.0 |        0.0 |      0.0 |       0.0 |
| openrouter/deepseek/deepseek-v4.1-flash | with    |     1 |    1 |    100% |  24331 |    1080 | $0.0066 |     11.2 |   3.0 |        0.0 |      2.0 |       0.0 |

## By project

| Project | Mode    | Cells | Runs | Success |    Cost | Wall (s) | Shell fail | Rewrites | Green (s) |
| ------- | ------- | ----: | ---: | ------: | ------: | -------: | ---------: | -------: | --------: |
| scripts | without |     1 |    1 |    100% | $0.0045 |      8.0 |        0.0 |      0.0 |       0.0 |
| scripts | with    |     1 |    1 |    100% | $0.0066 |     11.2 |        0.0 |      2.0 |       0.0 |

## Excluded (unmatched)

5 unmatched run(s) are excluded from every comparison above.

| Project            | Model                                   | Mode | Run ID                                                                              |
| ------------------ | --------------------------------------- | ---- | ----------------------------------------------------------------------------------- |
| monorepo           | openrouter/deepseek/deepseek-v4.1-flash | with | 20261108T170620Z-monorepo-with-openrouter-deepseek-deepseek-v4.1-flash-r1           |
| monorepo           | openrouter/deepseek/deepseek-v4.1-flash | with | 20261108T170815Z-monorepo-with-openrouter-deepseek-deepseek-v4.1-flash-r1           |
| pnpm-web           | openrouter/deepseek/deepseek-v4.1-flash | with | 20261108T170620Z-pnpm-web-with-openrouter-deepseek-deepseek-v4.1-flash-r1           |
| poetry-django-lite | openrouter/deepseek/deepseek-v4.1-flash | with | 20261108T170620Z-poetry-django-lite-with-openrouter-deepseek-deepseek-v4.1-flash-r1 |
| uv-cli             | openrouter/deepseek/deepseek-v4.1-flash | with | 20261108T170620Z-uv-cli-with-openrouter-deepseek-deepseek-v4.1-flash-r1             |
