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

The five rules bashlight ships with are tried in this priority order —
`redundant-runner`, `pip-to-manager`, `bare-python`, `python-runner`, `node-manager` —
and the first one that does not keep a command decides the round. Your own rules run
before all of them (see [Your own rules](#your-own-rules)).

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

## Your own rules

You do not clone bashlight, install it, or write a plugin to add a rule. Drop a
TypeScript (or JavaScript) file into a `rules` folder and it is picked up:

| Where                                      | Applies to                         |
| ------------------------------------------ | ---------------------------------- |
| `<project>/.opencode/bashlight/rules/*.ts` | that project                       |
| `~/.config/opencode/bashlight/rules/*.ts`  | every project (`$XDG_CONFIG_HOME`) |

The file's **default export** is one of:

- a `Rule` object,
- a factory `(helpers) => Rule | Rule[]`,
- an array of either.

The factory receives the `helpers` it needs, so the file has **no runtime import of
bashlight at all** — the loader hands it the verdict builders (`keep`, `block`,
`replace`, `arg`, `argsFrom`, `text`, `indexRange`) and the command-line parsers a rule
author wants (`parsePythonCommand`, `parseNodeCommand`, `isVenvActive`).

Say your team's Python projects all define a `make test` target and you want `pytest` to
go through it. `RuleContext` gives the working directory at that exact command and a
read-only `files` view, so the rule can check for a `Makefile` without importing
`node:fs`:

```ts title=".opencode/bashlight/rules/make-test.ts"
export default (helpers) => ({
    id: "make-test",
    scope: "local",
    inspect(call, context) {
        if (call.argv[0]?.value !== "pytest" || context.cwd === undefined) {
            return helpers.keep();
        }
        if (!context.files.exists(`${context.cwd}/Makefile`)) {
            return helpers.keep();
        }
        return helpers.replace(
            [...helpers.text("make", "test"), ...helpers.argsFrom(call.argv, 1)],
            "run the project's make target",
        );
    },
});
```

`helpers.replace` reuses original arguments through `helpers.argsFrom` (so quoting and
origins survive) and introduces new literal words with `helpers.text`; the rewriter
quotes them according to where they land.

### Try it, then trust it

`bashlight explain` runs your rule through the real pipeline, and `bashlight rules`
shows which rules loaded and where from:

```console
$ bashlight explain 'pytest -q' --cwd ~/dev/shop
rewritten:
  - pytest -q
  + make test -q
changes:
  - rules: make-test  reasons: run the project's make target
      pytest -q → make test -q

$ bashlight rules --cwd ~/dev/shop
bashlight rules in /home/user/dev/shop

Active:
   1  make-test         project  /home/user/dev/shop/.opencode/bashlight/rules/make-test.ts
   2  redundant-runner  builtin
   …
```

A file that fails to load, or a rule that throws, is skipped and logged (to stderr in
the plugin); it never breaks the shell call, and `doctor` reports it.

### Reload, precedence and overriding

On the next command, bashlight re-scans both folders and reloads any file whose
modification time changed — **edit a rule and it takes effect immediately, no OpenCode
restart**.

- Your rules run **before** the built-ins, and a custom rule with the same `id` as a
  built-in **replaces** it.
- `disabledRules` removes any rule, built-in or custom.
- Custom rules are resolved from the session's project directory; a project rule always
  wins over a global one with the same `id`.

### Types (optional)

The file above needs no import. If you want type-checking, add bashlight as a dev
dependency and import the contract type-only — type-only imports are erased at runtime,
so a missing package never breaks loading:

```ts title=".opencode/bashlight/rules/make-test.ts"
import type { RuleFactory } from "bashlight";

const makeTest: RuleFactory = (helpers) => ({
    // …
});

export default makeTest;
```

```console
$ bun add -d github:OffworldNexus/bashlight
```

To disable a built-in you do not want, list it in
[`disabledRules`](getting-started.md#options).
