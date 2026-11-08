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

Because a bare `uv run python` gets an empty ephemeral environment, the rule reads the
code it is about to run — a `-c` snippet, a script file, a heredoc/herestring on stdin,
or a `-m` module — and adds `--with <dist>` for the imports whose distribution it knows
**with confidence**. So probing a module and then using it agree:

```bash
$ python3 - <<'EOF'
print(1)
EOF
→ uv run python - <<'EOF'
print(1)
EOF

$ python3 -c 'import cairosvg'
→ uv run --with cairosvg python -c 'import cairosvg'

$ python3 -c 'import slugify'     # the package is python-slugify, not slugify
→ uv run --with python-slugify python -c 'import slugify'

$ python3 - <<'EOF'
import requests
print(requests.get("https://example.com"))
EOF
→ uv run --with requests python - <<'EOF'
import requests
print(requests.get("https://example.com"))
EOF

$ python -m black .
→ uv run --with black python -m black .

$ python probe.py          # probe.py imports cairosvg
→ uv run --with cairosvg probe.py

$ python main.py
→ uv run main.py

$ python -c 'import os, sys'       # stdlib only: no --with
→ uv run python -c 'import os, sys'

$ python -c 'import mysterylib'    # unknown distribution: no --with
→ uv run python -c 'import mysterylib'

$ pip install requests
→ blocked
```

Standard-library imports add nothing and local modules (`<name>.py` or `<name>/` next to
the code) are not downloaded. `--with` is only added for a curated list of imports whose
distribution is known with confidence, which maps the common mismatches (`PIL` →
`pillow`, `slugify` → `python-slugify`, `cv2` → `opencv-python`, `yaml` → `pyyaml`, …).
An import outside that list — including a top-level name shared by several popular
packages, such as `google` — gets nothing: guessing would install the wrong library, so
the probe answers "no", honestly. Past ten dependencies the plain run is kept. A script
that already carries a PEP 723 `# /// script` block is left to `uv` as-is.

The block message first looks for a Python project in nearby child directories (depth ≤
2, skipping hidden and vendored ones). If it finds one, it points there instead:

```console
$ pip install pytest python-slugify      # at a monorepo root with api/ below
→ blocked:
  This directory is not a Python project, but api/ is (Poetry). Run it there:
  `cd api && pip install pytest python-slugify` — bashlight will use the project's own tool.
```

Otherwise it keeps the PEP 723 guidance: a PEP 723 script,
`uv run --with <pkg> python …`, or `uvx <tool>`.

An explicit executable inside a virtualenv's `bin` (`.venv/bin/pytest`,
`venv/bin/python`, an absolute `…/venv/bin/mypy`) is always left untouched: it already
names the exact interpreter the project wants, so no rule routes it through a runner.

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

!!! warning "Rule files run with your full privileges"

    A custom rule is code that runs inside the OpenCode process, with the same access to
    your machine as bashlight itself. Global rules in your own config directory are
    always trusted, but **a project's rule files are not loaded until you trust that
    project** — a rule file committed to a repo you just cloned must not get to run code
    (or shell out) the first time you use OpenCode there.

You do not clone bashlight, install it, or write a plugin to add a rule. Drop a
TypeScript (or JavaScript) file into a `rules` folder and it is picked up:

| Where                                      | Applies to                         | Trust                      |
| ------------------------------------------ | ---------------------------------- | -------------------------- |
| `<project>/.opencode/bashlight/rules/*.ts` | that project                       | `bashlight trust` required |
| `~/.config/opencode/bashlight/rules/*.ts`  | every project (`$XDG_CONFIG_HOME`) | always trusted             |

Project rules are resolved from the session's project directory. Until that directory is
trusted, they are skipped: `bashlight rules` and `bashlight doctor` say how many were
found but not trusted, and the plugin logs it once per project. The trust list is a JSON
array of absolute directories in `~/.config/opencode/bashlight/trusted.json`; trusting a
directory trusts everything under it.

```console
$ bashlight trust ~/dev/shop          # allow this project's rule files
trusted /home/user/dev/shop
  enables /home/user/dev/shop/.opencode/bashlight/rules/make-test.ts

$ bashlight untrust ~/dev/shop        # stop loading them again
untrusted /home/user/dev/shop
```

The whole project-rule system can be turned off at once with the
[`customRules` option](getting-started.md#options).

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

A file that fails to load, throws, or takes too long is skipped and logged (to stderr in
the plugin); it never breaks the shell call, and `doctor` reports it.

### Reload, precedence and overriding

bashlight re-scans both folders on every command. When **any** file in a rules folder
changes (its mtime or size, or a file appears or disappears), that whole folder reloads
and its modules are evicted from the runtime cache — so a helper a rule imports from the
same folder is reloaded too. **Edit a rule and it takes effect on the next command, no
OpenCode restart.** Imports from outside the rules folder are not reloaded until
OpenCode restarts.

- Your rules run **before** the built-ins, and a custom rule with the same `id` as a
  built-in **replaces** it.
- `disabledRules` removes any rule, built-in or custom; `customRules: false` removes
  every custom rule.
- A project rule always wins over a global one with the same `id`.

The import and the factories run behind a **2-second budget**: a rule file that takes
longer is reported as a load error. `inspect` itself must stay fast and synchronous (a
rule that loops forever cannot be preempted), so keep the real work in the factories,
not in `inspect`.

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
