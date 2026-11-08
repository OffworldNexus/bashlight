# Contributing

This page is for people working **on** bashlight. To _use_ it, see
[Getting started](getting-started.md) — end users never clone anything.

## Set up

```console
$ git clone https://github.com/OffworldNexus/bashlight ~/dev/bashlight
$ cd ~/dev/bashlight && bun install
```

`bun install` pulls the build-time tooling. bashlight ships with **no runtime
dependencies**: `@opencode/plugin` is a dev dependency, imported type-only by the plugin
entry point, and `Plugin.define` was only ever an identity function.

## Test and check

```console
$ make clean   # prettier + eslint + tsc
$ make test    # bun test
$ make help    # the targets
```

Individually: `bunx prettier --write .`, `bunx eslint .`, `bunx tsc --noEmit`,
`bun test`. The contract every module must honour is in
[`DESIGN.md`](https://github.com/OffworldNexus/bashlight/blob/develop/DESIGN.md);
`docs/` is built with `uvx zensical build --strict`.

Unit tests live under `tests/<module>/`; `tests/cases/` holds hand-written end-to-end
examples. `corpus/` is a private git submodule of anonymized real commands:

```console
$ git submodule update --init corpus
```

The corpus tests are skipped when the submodule is absent, so `bun test` works on a bare
clone (as on CI). Refresh the reviewed golden file with
`BASHLIGHT_UPDATE_GOLDEN=1 bun test`.

## Dogfooding the working tree

The repository enables its own checkout through a one-line file:

```ts title=".opencode/plugins/bashlight.ts"
export { default } from "../../src/opencode/plugin.ts";
```

This is a **contributor convenience only** — it is not how end users install bashlight.
It lets OpenCode load the working tree (and edits reload on the next command) while you
develop.

## Architecture at a glance

```
src/
  shared/    pure POSIX path helpers (the only leaf module)
  syntax/    lexer, parser, AST with exact source spans
  interp/    static pre-interpreter: environment, expansion, wrappers
  project/   toolchain inspection over a FileSystem
  rules/     Rule contract, engine, shared knowledge, built-ins, custom loader
  rewrite/   edit planning, shell quoting, re-validation
  opencode/  OpenCode plugin adapter (the only place that reads process.env)
  cli/       the bashlight CLI
```

The package exposes `./src/index.ts` (the library and the rule types) as `"."`, and
`./src/opencode/plugin.ts` as both `"./server"` (what OpenCode loads) and
`"./opencode"`.

## Release checklist

bashlight is `"private": true` until it is published, which blocks an accidental
`npm publish` but does not block installing it from GitHub (the current install method).

1. Flip `"private": true` to `false` in `package.json`.
2. Publish: `npm publish` (the `files` list is already `src`, `bin`, `README.md`,
   `LICENSE`; there are no runtime dependencies).
3. Switch the install docs to the published package. The places to update:
    - `README.md` and `docs/getting-started.md`: the `plugins` entry becomes
      `"plugins": ["bashlight"]`, and the CLI becomes `bunx bashlight …`.
    - `docs/monitoring.md` and the README alias line: drop the
      `--package github:OffworldNexus/bashlight` prefix.
4. Tag the release and note that `"bashlight"` tracks the latest version while
   `"bashlight@<version>"` pins one — see [Updating](getting-started.md#updating).
