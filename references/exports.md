# Exports

What a repo imports from `@workerstack/repo`. `bun repo docs --check` type-checks each `ts` block below against the installed package.

## Config

`workerstack.config.ts` at the root default-exports `defineConfig` from `@workerstack/repo`; `bun repo init` writes it.

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

`@workerstack/repo/lint` is the oxlint JS plugin behind every `repo/*` rule. `bun repo sync` names it in the generated `.oxlintrc.json`, so a repo never imports it by hand.

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

`bun repo lint --fix` and `bun repo turn` run Stylelint's fix first (property order, hex length), then oxfmt on the sheets it rewrote, and `--staged` restages them. `bun repo lint src/a.css` runs Stylelint alone. A `lint.skip` entry takes `stylelint/<rule>` (`rules: ["stylelint/no-descending-specificity"]`); a misspelled one fails `bun repo check` as `has no hit`. A checkout with no CSS runs no Stylelint.

## Tailwind classes

Under the `standards` pack, a checkout with a Tailwind v4 entry sheet gets oxlint-tailwindcss 1.17.0's class rules at error: `tailwindcss/no-unknown-classes`, `no-conflicting-classes`, `no-duplicate-classes` and `no-hardcoded-colors`. `bun repo sync` takes the one sheet Stylelint lints whose line `@import "tailwindcss"` (or `'tailwindcss'`, with `source(…)` or a layer after it) loads the theme, and writes it into `.oxlintrc.json` as `settings.tailwindcss.entryPoint` and into `.oxfmtrc.jsonc` as `sortTailwindcss.stylesheet`. The plugin loads as `@workerstack/repo/tailwind`, so it resolves from this package's install. Without such a sheet nothing changes.

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

A scope merges like `createScriptEnv`: own `global`, then the parent's scope view, then own scope; the later wins. `global` is the parent's `global` then own. The instance holds:

| Member | Reads |
| --- | --- |
| `current` | the scope `REPO_ENV` names (`local`, `dev` or `prod`; `local` when unset), checked at each read; a key that scope lacks throws |
| `global` `local` `dev` `prod` | that view's merged values |
| `process` | the declared process variables, read from `process.env` at each read |
| `read(source)` | the `process` view of another `source` object (a test seam) |
| `sealedKeys(scope)` | the set of keys whose winning value in `scope` is sealed |

`sealed("<base64>")` takes the base64 of an age cipher made for the recipient in `.repo/env.keys.json` (`{ "recipient": "age1…", "repo": "<name>" }`); plaintext or an empty string throws at once. Nothing decrypts until a sealed value is read: the first such read decrypts every sealed value of the env and its parents in one `bun` child and keeps the plaintext in that instance only, so a plain read needs no key. The key is `WORKERSTACK_ENV_KEY` (an age identity) when set, else every `~/.workerstack/keys/*.key`; the repo's own is `~/.workerstack/keys/<repo>.key`, saved at 0600.

The runtime errors, one line each (`<key>` is the read, `<repo>` the name in `.repo/env.keys.json`):

```console
repo env: REPO_ENV is "staging"; set it to local, dev or prod
repo env: NPM_TOKEN has no prod value in src/env.ts; add it to its prod block
repo env: process.HOME is required and unset
repo env: NPM_TOKEN is sealed and no key is at ~/.workerstack/keys/<repo>.key; save this repo's age key there (0600) or set WORKERSTACK_ENV_KEY
repo env: NPM_TOKEN is sealed for another key than ~/.workerstack/keys/<repo>.key; save this repo's age key there
repo env: NPM_TOKEN could not be decrypted: <reason>
```

`bun repo check` reads every tracked `.ts`, `.tsx` and `.mts` file that calls `defineEnv(` and fails, one line each:

```console
env: src/env.ts global.NPM_TOKEN looks like a secret (credential name) but is plain; seal it: sealed("<base64 of `age -r <recipient in .repo/env.keys.json>`>")
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
