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
