# bashlight benchmark results

Runs: 7 · Success: 6/7 · Total cost: $0.0949

All columns except `Runs` are per-run means.

## By model

| Model                                   | Mode    | Runs | Success | In tok | Out tok |    Cost | Wall (s) | Shell | Shell fail | Rewrites | Green (s) |
| --------------------------------------- | ------- | ---: | ------: | -----: | ------: | ------: | -------: | ----: | ---------: | -------: | --------: |
| openrouter/deepseek/deepseek-v4.1-flash | without |    1 |    100% |  17227 |     543 | $0.0045 |      8.0 |   2.0 |        0.0 |      0.0 |       0.0 |
| openrouter/deepseek/deepseek-v4.1-flash | with    |    6 |     83% |  25872 |    8871 | $0.0151 |     48.3 |  16.5 |        1.2 |      1.0 |      41.8 |

## By project

| Project            | Mode    | Runs | Success |    Cost | Wall (s) | Shell fail | Rewrites | Green (s) |
| ------------------ | ------- | ---: | ------: | ------: | -------: | ---------: | -------: | --------: |
| monorepo           | with    |    2 |     50% | $0.0208 |     69.9 |        1.5 |      0.5 |      64.1 |
| pnpm-web           | with    |    1 |    100% | $0.0058 |     24.4 |        1.0 |      0.0 |      21.8 |
| poetry-django-lite | with    |    1 |    100% | $0.0110 |     53.5 |        1.0 |      2.0 |      48.7 |
| scripts            | without |    1 |    100% | $0.0045 |      8.0 |        0.0 |      0.0 |       0.0 |
| scripts            | with    |    1 |    100% | $0.0066 |     11.2 |        0.0 |      2.0 |       0.0 |
| uv-cli             | with    |    1 |    100% | $0.0256 |     60.9 |        2.0 |      1.0 |      51.9 |
