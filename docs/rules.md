# Rules

A rule looks at **one fully expanded command** and decides what should happen to it. It
never sees source text and never produces an edit: it returns a verdict, and the
[rewriter](how-it-works.md#the-rewrite-strategies-most-surgical-first) works out how to
express that verdict in the original script.

```ts
type Verdict =
    | { kind: "keep" }
    | {
          kind: "replace";
          argv: readonly Replacement[];
          env?: Readonly<Record<string, string>>;
          reason: string;
      }
    | { kind: "block"; message: string };
```

The engine only inspects external commands whose `argv[0]` is known, on the host the
rule declares (`"local"` or `"any"`). A `replace` is fed back through the rules on the
new argv until nothing changes it, a cycle appears, or eight rounds pass — so
`poetry run poetry run x → poetry run x` is just two rules agreeing. The first `block`
wins for the whole command.

The five rules bashlight ships with are in `src/rules/builtin/`. They are tried in this
priority order — `redundant-runner`, `pip-to-manager`, `bare-python`, `python-runner`,
`node-manager` — and the first one that does not keep a command decides the round.

## `python-runner`

Runs Python — and project tools like `pytest`, `mypy`, `ruff`, `black`, `django-admin` —
through the project's runner. It also fixes the _wrong_ runner, and leaves a command
alone when a virtualenv is already active.

```bash
# a Poetry project
$ python manage.py check
→ poetry run python manage.py check

# but this project uses uv
$ poetry run python manage.py check
→ uv run python manage.py check

# a venv is sourced, so the environment is already right
$ source .venv/bin/activate && python main.py
→ unchanged

# wrappers are peeled before the rule looks
$ sudo -E timeout 60 python manage.py check
→ sudo -E timeout 60 poetry run python manage.py check

$ find . -name '*.py' -exec python {} \;
→ find . -name '*.py' -exec poetry run python {} \;

# argv[0] is not statically known, so it is left alone
$ $(which python) main.py
→ unchanged
```

## `pip-to-manager`

Turns `pip` into the project manager's equivalent, for install, uninstall and read-only
commands. `-e .`, `-r`, `-U` and pinned versions all map to the manager's spelling.

```bash
# Poetry
$ pip install requests
→ poetry add requests

$ pip install -U requests
→ poetry add requests@latest

$ pip install requests==2.31.0
→ poetry add requests==2.31.0

$ pip install -e .
→ poetry install

$ pip uninstall requests
→ poetry remove requests

# read-only pip runs inside the project environment
$ pip list
→ poetry run pip list

# uv
$ python -m pip install requests
→ uv add requests

$ pip install -r requirements.txt
→ uv add -r requirements.txt

# a bare venv has no manager to translate to, so nothing changes
$ pip install requests        # venv-only project
→ unchanged
```

## `bare-python`

Outside any Python project, Python has no environment to run in: `python` becomes
`uv run python`, and installing with `pip` is the one command bashlight blocks.

```bash
$ python3 - <<'EOF'
print(1)
EOF
→ uv run python - <<'EOF'
print(1)
EOF

$ python main.py
→ uv run main.py

$ python -c 'print(1)'
→ uv run python -c 'print(1)'

$ pip install requests
→ blocked
```

The block message points at the three ways to run a one-off dependency under `uv`: a PEP
723 script, `uv run --with <pkg> python …`, or `uvx <tool>`.

## `node-manager`

When the project's manager is not the one the agent used, the subcommand is translated
to the manager's spelling — including `npx`, which becomes `pnpm exec` for a declared
tool and `pnpm dlx` for an undeclared one.

```bash
# pnpm project
$ npm install -D vitest
→ pnpm add -D vitest

$ npm run build
→ pnpm run build

$ npm ci
→ pnpm install --frozen-lockfile

$ npx vitest run          # vitest is a dependency
→ pnpm exec vitest run

$ npx prettier --write .  # prettier is not
→ pnpm dlx prettier --write .

# npm project
$ pnpm add -D vitest
→ npm install -D vitest

# Bun project
$ npm install
→ bun install

$ npx vitest run
→ bunx vitest run
```

## `redundant-runner`

Collapses a runner applied to itself.

```bash
$ poetry run poetry run python manage.py check
→ poetry run python manage.py check

$ npx npx vitest run
→ npx vitest run
```

## Write your own rule

A rule is an object with a stable `id`, a `scope`, and an `inspect` method. The
`RuleContext` gives it the working directory at that exact command, the host, and the
project inspectors — but not arbitrary file reads, so a rule that needs more than "which
toolchain is here" closes over a `FileSystem` of its own.

Say your team's Python projects all define a `make test` target and you want `pytest` to
go through it. The rule only needs the command and the working directory:

```ts title="make-test.ts"
import type { Rule, RuleContext, CommandCall, Verdict } from "bashlight";
import { argsFrom, keep, replace, text } from "bashlight";
import { NodeFileSystem } from "bashlight";

const files = new NodeFileSystem();

export const makeTest: Rule = {
    id: "make-test",
    scope: "local",
    inspect(call: CommandCall, context: RuleContext): Verdict {
        if (call.argv[0]?.value !== "pytest" || context.cwd === undefined) {
            return keep();
        }
        if (!files.exists(`${context.cwd}/Makefile`)) {
            return keep();
        }
        return replace(
            [...text("make", "test"), ...argsFrom(call.argv, 1)],
            "run the project's make target",
        );
    },
};
```

`replace` reuses original arguments through `argsFrom` (so quoting and origins survive)
and introduces new literal words with `text`. The rewriter quotes them according to
where they land.

Because `createBashlight({ rules })` **replaces** the built-in set, spread the built-ins
in to keep them:

```ts title="setup.ts"
import { createBashlight, createBuiltinRules, NodeFileSystem } from "bashlight";

import { makeTest } from "./make-test.ts";

const fileSystem = new NodeFileSystem();
const processor = createBashlight({
    fileSystem,
    rules: [...createBuiltinRules(), makeTest],
});
```

To drop a built-in instead, leave it out of `rules`, or disable it per project with the
[`disabledRules` option](getting-started.md#options).
