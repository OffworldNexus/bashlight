# bashlight benchmark results

Runs: 36 · Success: 20/36 · Total cost: $0.6996

All columns except `Runs` are per-run means.

| Model                                        | Mode    | Runs | Success | In tok | Out tok |    Cost | Wall (s) | Shell | Shell fail | Rewrites |
| -------------------------------------------- | ------- | ---: | ------: | -----: | ------: | ------: | -------: | ----: | ---------: | -------: |
| openrouter/deepseek/deepseek-v4.1-flash      | without |    6 |    100% |  29309 |    4749 | $0.0097 |     33.3 |   7.8 |        0.3 |      0.0 |
| openrouter/deepseek/deepseek-v4.1-flash      | with    |    6 |    100% |  26923 |    3428 | $0.0073 |     26.5 |   6.2 |        0.0 |      0.2 |
| openrouter/openai/gpt-5-nano                 | without |    6 |     67% |   6816 |    5266 | $0.0034 |     55.7 |   6.0 |        2.0 |      0.0 |
| openrouter/openai/gpt-5-nano                 | with    |    6 |     50% |   4960 |    4953 | $0.0031 |     44.8 |   6.2 |        1.7 |      0.7 |
| openrouter/qwen/qwen3-coder-30b-a3b-instruct | without |    6 |      0% | 346889 |    4757 | $0.0549 |     44.3 |  16.5 |        5.0 |      0.0 |
| openrouter/qwen/qwen3-coder-30b-a3b-instruct | with    |    6 |     17% | 240136 |    3615 | $0.0382 |     37.8 |  13.5 |        4.3 |      2.8 |
