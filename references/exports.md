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

Under the `standards` pack, `bun repo lint`, `bun repo check`, `bun repo turn` and `bun repo lint --baseline` also lint every tracked `.css` file outside `fixtures` dirs with Stylelint 17 and three packs: `stylelint-config-standard`, `@dreamsicle.io/stylelint-config-tailwindcss` (Tailwind v4 at-rules and `--alpha()`/`--spacing()`, plus `@config` and `@plugin`) and `stylelint-config-recess-order`. The config lives in this package, so nothing is written to your repo and the packs resolve from its install. Each warning is one `stylelint(<rule>)` hit the baseline counts like any other:

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

## Agents and references

`@workerstack/repo/agents/*` holds the stock skills, rules, subagents and hooks that `bun repo sync` links into each host tree. `@workerstack/repo/references/*` holds these files, which a repo's own `references/INDEX.md` links in `node_modules`.
