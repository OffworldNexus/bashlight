# Benchmark

Does bashlight make an agent _succeed_ more often, or just make the transcript look
tidier? The benchmark answers that with numbers, not anecdotes. It builds a set of fake
projects — a Poetry service, a uv library, a pnpm front-end and so on — each with a
small set of tasks that have a clear success condition (a test passes, a dependency is
declared, a script is run). Every task is then run twice by each model: once with the
plugin disabled and once with it enabled, against the same fake project and the same
prompt. A handful of cheap models are used on purpose, because that is where a silently
corrected command should matter most. Each run records whether the task succeeded, and
the tokens, wall-clock time and cost it took. The headline is the success-rate
difference; the rest shows what it cost to buy.

Results: see below

<!-- BENCHMARK RESULTS -->
