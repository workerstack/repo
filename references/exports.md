---
description: What the package exports
---

# Exports

What a repo imports from `@workerstack/repo`. `bun repo docs --check` type-checks each `ts` block below against the installed package.

## Config

`repo.config.ts` at the root default-exports `defineConfig` from `@workerstack/repo`; `bun repo init` writes it. `workflow` says how changes reach the default branch: `"worktree"` (the default), `"pull-request"` or `"main"`; `workflow.md` says what each mode does.

```ts
import { defineConfig } from "@workerstack/repo";

export default defineConfig({
  packs: ["agents", "standards", "docs", "release"],
  lint: {
    skip: [{ files: ["src/legacy/**"], rules: ["max-lines"], reason: "split in #12" }],
    boundaries: {
      tags: { "@app/web": "app", "@app/ui": "ui", "@app/lib": "lib" },
      allow: { app: ["ui", "lib"], ui: ["lib"], lib: [] },
    },
    tailwind: { entryPoint: "apps/web/src/app.css" },
  },
});
```

## Lint plugin

`@workerstack/repo/lint` is the oxlint JS plugin behind every `repo/*` rule. `bun repo sync` names it in the generated `.oxlintrc.jsonc`, so a repo never imports it by hand.

```ts
import plugin from "@workerstack/repo/lint";

const names: string[] = Object.keys(plugin.rules);
console.log(`${plugin.meta.name}: ${names.length} rules`);
```

## Stylelint

Under the `standards` pack, `bun repo lint`, `bun repo check`, `bun repo turn` and `bun repo lint --baseline` also lint every tracked `.css` file outside `__fixtures__` dirs with Stylelint 17 and three packs: `stylelint-config-standard`, `@dreamsicle.io/stylelint-config-tailwindcss` (Tailwind v4 at-rules and `--alpha()`/`--spacing()`, plus `@config` and `@plugin`) and `stylelint-config-recess-order`. The config lives in this package, so nothing is written to your repo and the packs resolve from its install. Each warning is one `stylelint(<rule>)` hit the baseline counts like any other:

```text
src/bad.css:4:10: error stylelint(color-hex-length): Expected "#ffffff" to be "#fff"
src/bad.css:9:3: error stylelint(order/properties-order): Expected "display" to come before "color"
```

`bun repo lint --fix` and `bun repo turn` run Stylelint's fix first (property order, hex length), then bun fmt on the sheets it rewrote, and `--staged` restages them. `bun repo lint src/a.css` runs Stylelint alone. A `lint.skip` entry takes `stylelint/<rule>` (`rules: ["stylelint/no-descending-specificity"]`); a misspelled one fails `bun repo check` as `has no hit`. A checkout with no CSS runs no Stylelint.

## Tailwind classes

Under the `standards` pack, a checkout with a Tailwind v4 entry sheet gets oxlint-tailwindcss 1.17.0's class rules at error: `tailwindcss/no-unknown-classes`, `no-conflicting-classes`, `no-duplicate-classes` and `no-hardcoded-colors`. `bun repo sync` takes the one sheet Stylelint lints whose line `@import "tailwindcss"` (or `'tailwindcss'`, with `source(…)` or a layer after it) loads the theme, and writes it into `.oxlintrc.jsonc` as `settings.tailwindcss.entryPoint` and into `.oxfmtrc.jsonc` as `sortTailwindcss.stylesheet`. The plugin loads as `@workerstack/repo/tailwind`, so it resolves from this package's install. Without such a sheet nothing changes.

```text
src/app.tsx:5:20: error tailwindcss(no-unknown-classes): "bg-foo-bar" is not a valid Tailwind class.
src/app.tsx:5:20: error tailwindcss(no-duplicate-classes): Duplicate class: "flex". Removing the second occurrence.
```

When two or more sheets import tailwindcss, sync fails and asks for `lint.tailwind.entryPoint`, the repo-relative sheet to check classes against; one that is no file or does not import tailwindcss fails sync too. A `lint.skip` entry may name a `tailwindcss/<rule>` only while an entry turns the rules on.

## Fixture folders

Test data lives in folders named `__fixtures__`, and every skip (lint, typecheck, Stylelint, jscpd, coverage, mutation, knip, sync pruning) leaves exactly that name out. `bun repo check` fails a folder named `fixtures`, `fixture`, `__fixture__`, `test-fixtures`, `test_fixtures` or `testdata`, tracked or untracked and not ignored, outside `__fixtures__`, `vendor` and the dependency dir:

```text
repo check: fixtures: cli/sync/fixtures is a fixture folder; rename it to cli/sync/__fixtures__ (bun repo fixtures --fix)
```

`bun repo fixtures` lists each such folder with the references it would rewrite (`cli/sync/fixtures -> cli/sync/__fixtures__ (41 references in 12 files)`), and `bun repo fixtures --fix` renames each with `git mv` and rewrites the path references to it in tracked, writable text files: a `/`-ended path that resolves to the folder (`./fixtures/`, `../fixtures/`, and a bare `<parent>/fixtures/` or `fixtures/` read from the root or from the file), and a quoted `"fixtures"` call argument whose quoted segments before it lead to the folder's parent (`path.join(dir, "fixtures")` beside it, `path.join(root, "<parent>", "fixtures")`). Prose, other quoted words and read-only generated files stay; `bun repo sync` rewrites those from their sources. A folder whose new name is taken is skipped and named.

## Public package deps

`bun repo check` judges where each public package declares the packages it hands consumers. A package is judged when its `package.json` says `"private": false` and has a non-empty `dependencies`, at the root and in every workspace package.

The type surface is what the package's exports give a consumer's compiler. Every typed export goes through an in-memory declaration emit, and nothing is written to disk. A `*` pattern expands over what npm packs: the `files` entries, or without `files` every file but tests, `__fixtures__`, `node_modules` and `.git`. A `null` target, or a conditions key whose every target is `null`, excludes what it matches. An export that points at a tsconfig, as the TypeScript presets do, brings the `.d.ts` files its `files` lists. Without `exports`, the package reads `types`, then `typings`, then `main`. A declaration that is not built yet maps back to its source through `tsconfig.build.json`.

A package counts as used when the surface names it with a bare import or a `/// <reference types>`, or uses a global it declares. A package that no field of the manifest declares, a transitive one, counts for the dep one hop up that brings it in. A package with no `bin` is a library, and every `dependencies` entry of a library fails: bundle it or make it a peer. A package with `bin` keeps the deps only its own code uses, and fails each one its exported types use. A version moves as written, so a workspace `catalog:` still holds. `optionalDependencies` are left alone.

```console
$ bun repo check
repo check: package.json: zod is in "dependencies" but the types of "." use it (cli/commit-config.ts); move it to "peerDependencies" and "devDependencies" keeping its version
repo check: packages/kit/package.json: nanoid is in "dependencies" of a library (no "bin"); bundle it, or move it to "peerDependencies" and "devDependencies"
repo check: packages/kit/package.json: the types of "./types" (types/index.d.ts) are missing; restore the file or drop the export
repo check: packages/kit/package.json: the types of "./client" (dist/client.d.ts) are missing and no tsconfig.build.json maps them to a source; build first or point "types" at the source
repo check: packages/kit/package.json: the types of "./server" (dist/server.d.ts) are missing and no source in tsconfig.build.json emits them; build first or point "types" at the source
repo check: packages/cli/package.json: could not read the types of its exports (Unexpected token in package.json)
```

## Vitest presets

`@workerstack/repo/vitest` gives `defineConfig` for a root `vitest.config.ts` (istanbul coverage with the per-file floors of `coverage-floors.json`) and `defineProject` for a workspace package's.

```ts
import { defineConfig } from "@workerstack/repo/vitest";

export default defineConfig({ test: { include: ["src/**/*.test.ts"] } });
```

## TypeScript presets

`@workerstack/repo/tsconfig/*` holds the shared `tsconfig` files: `base`, `strict`, `bun`, `web` and `worker`.

```json
{ "extends": "@workerstack/repo/tsconfig/bun", "include": ["**/*.ts"] }
```

## Commit messages

The generated `commit-msg` hook (`bun repo commit-msg`) holds a message to its subject plus at most three more things. Anything else is refused, and each refusal names the fix:

| Refused | Passes instead |
| --- | --- |
| a `Key: value` line (`Co-Authored-By: A <a@b.c>`, `Signed-off-by:`, `Why: x`) | a plain sentence for a why |
| an attribution: `🤖`, `noreply@anthropic.com`, or a line starting `Generated with` | nothing; the work is the author's (a subject that says "generated with" passes) |
| a `Breaking:` line | a `BREAKING CHANGE: <what breaks>` footer (the line and the non-blank lines after it) |
| any other body line | nothing: subject only |
| a commit over `commit.maxChangedLines` with no body line | one line saying why, even beside a footer |
| two or more why-lines over the limit | one line |

Allowed besides the subject: a `BREAKING CHANGE:` footer, git's revert line `This reverts commit <sha>.` (7 to 40 hex digits), and, only over the size limit, one why-line. Merge commits pass. The subject takes the types `feat fix perf refactor test docs build ci chore revert`, with `!` before the colon for a breaking change; a plan's `commit:` line takes the same list.

On Linux, `git commit --amend` (an alias for it too) is judged as the whole commit it makes: the size limit, the test and CHANGELOG rules and red-proof read the change from `HEAD^`, not only the newly staged lines. Elsewhere an amend is judged on its staged lines, as a plain commit is.

```console
$ git commit -m "feat: add x" -m "Co-Authored-By: A <a@b.c>"
commit-msg: the message was refused
  - remove "Co-Authored-By: A <a@b.c>"; commits carry no Key: value lines (write a why as a plain sentence)
```

## Push

`bun repo push [<branch>]` pushes a branch and waits on its ci run with `bun repo ci wait`. Without a branch it picks one: the default branch is `origin/HEAD`; the recent branches are those in the last 30 reflog entries and the 8 newest heads that were committed to within 7 days, minus the default branch and `wt/*`.

| On | Result |
| --- | --- |
| a `wt/*` branch | exit 1: run `bun repo worktree finish <name>` from the root, then `bun repo push` there |
| a `wt/*` branch, under pull-request | exit 1: run `bun repo worktree finish <name>`, which pushes the branch and opens its pull request |
| the default branch it would push, under pull-request | exit 1: `<default> takes changes only through pull requests (workflow is pull-request): run bun repo worktree finish <name> to push wt/<name> and open its pull request`; `(repo.config.ts failed to load)` when the config fails to load |
| another non-default branch | pushes it |
| the default branch, no recent branch | pushes the default branch |
| the default branch, one recent branch | pushes that branch |
| the default branch, several | exit 5, naming them: run `bun repo push <branch>` |
| a detached HEAD, or no `origin` default branch | exit 4 (`git remote set-head origin --auto` for the latter) |

A branch with no upstream is pushed with `git push -u origin <branch>`. The push runs through the pre-push hook and shows its output. Exit codes: 0 passed, 1 failed (a refused push, a worktree branch, or a failed ci run), 2 superseded, 3 nothing to wait on, 4 error (also a bad argument: `usage: repo push [<branch>]`), 5 ask. After the push, 0 to 4 are `bun repo ci wait`'s.

## Bench

The `benchmark` pack also links the `/benchmark` skill, which picks the dimensions and writes the spec.

`bun repo bench <name>` runs `.repo/bench/<name>.bench.ts`, whose default export is `defineBench` from `@workerstack/repo/bench` (with the types `BenchSpec`, `BenchCandidate`, `BenchMetric`, `Better` and `OsLabel`):

```ts
import { defineBench } from "@workerstack/repo/bench";

export default defineBench({
  candidates: { bun: { run: ["bun", "x.ts"] }, node: { run: ["node", "x.mjs"], setup: ["bun", "build", "x.ts"] } },
  metrics: { ops: { better: "higher", unit: "ops/s", weight: 1 }, rss: { weight: 1 }, wall: { weight: 2 } },
  os: ["ubuntu-latest", "macos-latest", "windows-latest"],
  runs: 10,
  warmup: 1,
});
```

| Field | Takes |
| --- | --- |
| `candidates` | at least one name (`a-z`, `0-9`, `-`) → `run` (the command, measured) and optional `setup` (run once before, unmeasured) |
| `metrics` | at least one name → `weight` over 0, `better` `lower` (default) or `higher`, optional `unit` |
| `runs` | measured runs per candidate, at least 3; default 10 |
| `warmup` | unmeasured runs per candidate first; default 1 |
| `os` | runner labels `--remote` measures on: `ubuntu-latest`, `ubuntu-24.04-arm`, `macos-latest`, `macos-13`, `windows-latest`; default none |

Built in, lower is better, weight only: `wall` (ms), `cpu` (ms, user plus system) and `rss` (MB, peak). Any other metric is read from the candidate's last stdout line, `bench: {"ops": 9120}`; a run without it fails. Candidates run interleaved, round-robin. Each candidate's score is the weighted mean, over metrics, of best/value (value/best when higher is better) on medians, × 100, so the best on every metric scores 100; medians are raised to a floor first (wall 0.1 ms, cpu 1 ms, rss 1 MB, custom 1e-6), so a 0 never divides. Each cell is `median ±CV% min–max`; a CV over 10% gets `!` and a line naming the cause. On Linux a child's peak RSS starts from the runner's own (the kernel carries it across exec), so the env records that peak as `rssFloorBytes` (null on macOS and Windows, which count per process), and an rss median within 5% of it gets `~` and a line saying the real peak is at most that. Columns go by weight, then name; rows by score, then name. The raw samples, machine and commit go to `.repo/tmp/bench/<name>/<os label>.json`.

```console
$ bun repo bench startup
startup · ubuntu-latest (linux x64) · AMD Ryzen 9 7950X (32) · 64 GB · bun 1.3.2 · 82c0e43+dirty · 10 runs, 1 warmup
candidate  score  wall ms (×2)       ops ops/s (×1)      rss MB (×1)
bun          100  41.2 ±4% 39–45     9120 ±3% 8700–9500  48.1 ±1% 47–49
node          62  88.0 ±11%! 76–104  7010 ±4% 6600–7400  61.3 ±1% 60–63
! node wall: CV 11% over 10%; rerun with more runs or a quieter machine (load from other work counts)
raw: .repo/tmp/bench/startup/ubuntu-latest.json
```

`--remote` also measures on the spec's other `os` labels in CI: it runs here first when this machine's label is listed, dispatches `bench.yml` (the `benchmark` pack) at HEAD's sha, waits up to 90 minutes, downloads each `bench-<name>-<os>` artifact and prints one table per OS. It refuses, one line each: no `.github/workflows/bench.yml`, bench.yml not on `origin/<default branch>` (GitHub dispatches only from there), HEAD not on origin, a dirty tree, and an `os` with no other label. Exit codes: 0 done, 1 a candidate or the remote run failed, 4 a bad argument, spec or precondition.

## Evals

`bun repo eval <name>` runs `evals/<name>/eval.ts` on Claude. It first prints a worst-case estimate and refuses a run over the cap before any call. The cap is $5.00 for a session run and $1.00 for an API run by default; `--max-cost <usd>` raises it. `--dry-run` stops after the estimate and reads no key. `--via session` (the default) runs each call as `claude -p` on the Claude Code session you are logged in to, with no key; Claude Code adds about 1500 hidden input tokens to every call, which the estimate counts, and a reply may pass the max tokens, so a run can overshoot the cap by the last case's extra output. Without the `claude` CLI logged in it prints `eval: --via session needs the claude CLI, logged in; install Claude Code, or use --via api` and exits 1. `--via api` calls the Anthropic API and needs `ANTHROPIC_API_KEY`; any other `--via` value exits 4 (`eval: --via takes session or api`). A real run stops before a case that could cross the cap, caches each answer under `.repo/tmp/evals/cache`, so a rerun of unchanged text costs $0 (session and API answers are cached apart), and writes a spend summary under `.repo/tmp/evals/runs`.

```console
$ bun repo eval skill-routing --dry-run
eval skill-routing: 24 cases x 3 samples = 72 calls on claude-haiku-5-5 via session, at most $0.0952 (cap $5.00)
```

An eval lists the repo files and folders its prompt and grader read as `files` in `defineEval`: repo-relative, with `/`, and each must exist, or the eval is refused (`eval broken: files.0: no file or folder agents/skills/nope`). `--changed <base>` runs every case of the eval when one of those, or anything under `evals/<name>/`, changed since the merge base with `<base>`, committed or not, and runs none otherwise (exit 0, no call made). `evals/rules-compliance` asks `claude-sonnet-5-5` its first step for real prompts, given the rules and the scope page, 2 samples a case so its API bound stays under the $1.00 cap; both evals pass an answer whose first word is the expected one.

```console
$ bun repo eval skill-routing --changed main --dry-run
eval skill-routing: agents/skills/su/SKILL.md changed since main
eval skill-routing: 24 cases x 3 samples = 72 calls on claude-haiku-5-5 via session, at most $0.0952 (cap $5.00)
$ bun repo eval rules-compliance --changed main
eval rules-compliance: nothing it reads changed since main
```

With the `evals` pack on, `bun repo github` keeps a GitHub environment named `evals` that needs one reviewer and deploys only from the default branch, and sync writes `.github/workflows/eval.yml`. It runs only when started by hand, with the eval's name and a cap in US dollars (empty takes the default for its via) and `via`, `session` (default) or `api`. Its one job runs in the `evals` environment, so it waits for your approval and reads the secret from there: `CLAUDE_CODE_OAUTH_TOKEN` for `session`, which installs `@anthropic-ai/claude-code@2.1.323` first, or `ANTHROPIC_API_KEY` for `api`. It restores and saves the answer cache, and uploads the summaries as the `eval-<name>` artifact.

```console
$ claude setup-token                                   # prints a long-lived token; copy it
$ gh secret set CLAUDE_CODE_OAUTH_TOKEN --env evals    # once, for --via session; paste the token
$ gh secret set ANTHROPIC_API_KEY --env evals          # once, only for --via api; also set a spend limit in the Anthropic console
$ gh workflow run eval.yml -f eval=skill-routing -f max-cost=0.5 -f via=session
```

The run then waits under "Review deployments" until you approve it. A dispatch from any branch but the default one is refused by the environment.

## Env

`@workerstack/repo/env` exports `defineEnv` and `sealed` (with the types `EnvConfig`, `EnvInstance`, `ProcessSpec`, `Scope`, `Sealed` and `Value`). It is for scripts: a Cloudflare Worker reads `ctx.env`, and `defineEnv` there throws the message "repo env: defineEnv is script-only; a Cloudflare Worker reads ctx.env".

```ts
import { defineEnv, sealed } from "@workerstack/repo/env";

export const repoEnv = defineEnv({
  global: { CLOUDFLARE_ACCOUNT_ID: "28fa2622…", NPM_TOKEN: sealed("YWdlLWVuY3J5cHRpb24ub3Jn…") },
  local: {},
  dev: {},
  prod: {},
  process: { CI: "optional", HOME: "required" },
});

repoEnv.current.NPM_TOKEN; // string, decrypted on the first sealed read
repoEnv.process.HOME; // string; CI is a key only when set (string | undefined)
```

| Field | Takes |
| --- | --- |
| `global` | values every scope shares; optional |
| `local` `dev` `prod` | one block per scope (required, may be `{}`); a string or `sealed(...)` per key |
| `process` | process variables this env reads → `"required"` (a string; throws when read unset) or `"optional"` (a key only when set, typed `?: string \| undefined`, so a spread over defaults keeps them) |
| `parent` | another `defineEnv` result; its values carry into each scope |

A scope merges in this order: own `global`, then the parent's scope view, then own scope; the later wins. `global` is the parent's `global` then own. The instance holds:

| Member | Reads |
| --- | --- |
| `current` | the scope `REPO_ENV` names (`local`, `dev` or `prod`; `local` when unset), checked at each read; a key that scope lacks throws |
| `global` `local` `dev` `prod` | that view's merged values |
| `process` | the declared process variables, read from `process.env` at each read |
| `read(source)` | the `process` view of another `source` object (a test seam) |
| `sealedKeys(scope)` | the set of keys whose winning value in `scope` is sealed |

`sealed("<base64>")` takes the base64 of an age cipher made for the recipient in `.repo/env.keys.json` (`{ "recipient": "age1…", "repo": "<name>" }`); plaintext or an empty string throws at once. Nothing decrypts until a sealed value is read: the first such read decrypts every sealed value of the env and its parents in one `bun` child and keeps the plaintext in that instance only, so a plain read needs no key. The key is `WORKERSTACK_ENV_KEY` (an age identity) when set, else every `~/.workerstack/keys/*.key`; the repo's own is `~/.workerstack/keys/<repo>.key`, saved at 0600.

### Commands

`bun repo env <verb>` seals, lists, reads and hands out the values of the `defineEnv` files, so no `age` CLI or base64 is needed. A value never enters argv: `set` reads a piped stdin whole (one trailing newline dropped) or, on a TTY, a hidden prompt.

```console
$ bun repo env init                                # rerun with the same key: repo env: already set up (acme)
repo env: wrote .repo/env.keys.json (recipient age1qz…) and ~/.workerstack/keys/acme.key (0600); back the key up in a password manager
$ echo "$v" | bun repo env set STRIPE_SECRET_KEY --scope prod      # --file <env file> picks the file
repo env: sealed prod.STRIPE_SECRET_KEY in projects/shop/env.ts
$ echo acme.io | bun repo env set APEX_DOMAIN --scope global --plain
repo env: wrote global.APEX_DOMAIN (plain) in projects/shop/env.ts
$ bun repo env ls
KEY                SCOPE   KIND    FILE                   USED BY
APEX_DOMAIN        global  plain   projects/shop/env.ts   projects/shop/deploy.ts
STRIPE_SECRET_KEY  prod    sealed  projects/shop/env.ts   projects/shop/deploy.ts, projects/shop/seed.ts
$ bun repo env get STRIPE_SECRET_KEY --scope prod                  # --reveal prints it whole
sk_test_51…••••
$ bun repo env run --scope prod -- wrangler deploy                 # values reach that child's env only
$ bun repo env export --scope dev --format dotenv
APEX_DOMAIN='acme.io'
$ pbpaste | bun repo env key import                # rerun: repo env: already set up (acme)
repo env: saved ~/.workerstack/keys/acme.key (0600); it unlocks .repo/env.keys.json's recipient
$ bun repo env key ci --dry-run
repo env: would run: gh secret set WORKERSTACK_ENV_KEY (the key on stdin)
```

| Verb | Does |
| --- | --- |
| `init` | writes `.repo/env.keys.json` and the key `~/.workerstack/keys/<repo>.key` (0600); the repo is named by the main checkout's folder, so a worktree names the same repo; the same key again prints `already set up`, a key file for another recipient is refused |
| `set KEY --scope s` | seals the value read from stdin into the env file's `s` block in place (or writes it plain with `--plain`; `--scope global` writes `global`), keeps every other byte, adds the `sealed` import when missing, and writes through a temp file and rename |
| `get KEY --scope s` | prints the value masked (first 10 characters, then `…••••`; `••••` under 12 characters); `--reveal` prints it whole |
| `ls` | one row per key: `KEY`, `SCOPE`, `KIND` (`plain` or `sealed`), `FILE` and `USED BY` (the tracked files that import the env file and name the key) |
| `run --scope s -- cmd` | runs `cmd` with the scope's values in its env only and passes its exit code through; `WORKERSTACK_ENV_KEY` is not handed to the child |
| `export --scope s --format dotenv` | prints the scope's values sorted, one `KEY=value` line each, quoted so dotenv and Bun's `--env-file` read them back: single quotes when the value has no `'`, else double quotes with only `\n` and `\r` escaped, else backticks |
| `key import` | reads an age identity from stdin, checks it unlocks the recipient in `.repo/env.keys.json` and saves it as `~/.workerstack/keys/<repo>.key` (0600); the same key again prints `already set up` |
| `key ci [--dry-run]` | sets the `WORKERSTACK_ENV_KEY` secret through `gh`, with the key on gh's stdin; of several keys it picks the one matching the recipient; `--dry-run` prints the line it would run |

The env file is `--file` when given, else the env files that declare the key, else the one env file in the repo. `export` refuses a value that has a `$` (Bun expands it in every quote, dotenv in none) or that no quote holds: `<KEY> has no dotenv quoting that bun and dotenv read back the same; pass it with \`bun repo env run\``. A bad verb or flag prints `usage: bun repo env init | set KEY --scope <global|local|dev|prod> [--plain] [--file f] | get KEY --scope s [--reveal] | ls | run --scope s -- cmd | export --scope s --format dotenv | key import | key ci [--dry-run]` on stderr and exits 4. A refusal is one line, exit 1:

```console
repo env: no defineEnv file declares STRIPE_SECRET_KEY; pass --file <env file>
repo env: 2 env files: a/env.ts, b/env.ts; pass --file
repo env: no .repo/env.keys.json; run `bun repo env init`
repo env: the pasted key does not unlock age1qz…; paste this repo's key
repo env: init found ~/.workerstack/keys/acme.key for another recipient; move it aside first
```

The runtime errors, one line each (`<key>` is the read, `<repo>` the name in `.repo/env.keys.json`):

```console
repo env: REPO_ENV is "staging"; set it to local, dev or prod
repo env: NPM_TOKEN has no prod value in src/env.ts; add it to its prod block
repo env: process.HOME is required and unset
repo env: NPM_TOKEN is sealed and no key is at ~/.workerstack/keys/<repo>.key; run `bun repo env key import`
repo env: NPM_TOKEN is sealed for another key than ~/.workerstack/keys/<repo>.key; run `bun repo env key import` with this repo's key
repo env: NPM_TOKEN could not be decrypted: <reason>
```

`bun repo check` reads every tracked `.ts`, `.tsx` and `.mts` file that calls `defineEnv(` and fails, one line each:

```console
env: src/env.ts global.NPM_TOKEN looks like a secret (credential name) but is plain; run `bun repo env set NPM_TOKEN --scope global`
env: src/env.ts dev.NPM_TOKEN is missing (prod has it); add it to dev or remove it from prod
env: src/env.ts reads process.env.HOME but its process block does not declare it; add `HOME: "optional"`
```

The reason is `sk_ prefix` (or another provider prefix), `high entropy` or `credential name`; `pk_live_` and `pk_test_` values pass. A scope block with a spread or no key takes no part in the missing-key rule. The check also reads a config held in a same-file const, through `as const`, `satisfies` or parentheses (`const config = { … } as const; defineEnv(config)`).

## Agents and references

`@workerstack/repo/agents/*` holds the stock skills, rules, subagents and hooks that `bun repo sync` links into each host tree. `@workerstack/repo/references/*` holds these files, which a repo's own `references/INDEX.md` links in `node_modules`.

A subagent source may carry `variants:`, a list of mappings. One source renders one subagent per entry, each entry deep-merging over the source's frontmatter without `variants`. Every entry needs a `name`, which names its file:

```yaml
variants:
  - name: implementer-deep
    claudecode:
      model: opus
  - name: implementer-fast
    claudecode:
      model: sonnet
tier: implementer
```
