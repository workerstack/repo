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
