import { defineConfig } from "@workerstack/repo";

export default defineConfig({
  agents: { skills: ["google-workspace", "listen", "speak", "clasp"] },
  coverage: { mutate: ["cli/**/*.ts", "presets/**/*.ts"] },
  knip: {
    ignore: [
      {
        file: "cli/stryker-preload.ts",
        reason: "repo mutate passes it to bun --preload by path; it is a script, so nothing imports it",
      },
      {
        dependency: "@stryker-mutator/core",
        reason: "repo mutate resolves its bin from the install of a clone and spawns it by path",
      },
      {
        dependency: "@stryker-mutator/vitest-runner",
        reason: "Stryker loads it by name from its config's testRunner: vitest",
      },
      {
        dependency: "oxlint",
        reason: "cli/scripts/lint.ts resolves its package.json with Bun.resolveSync and spawns its bin script by path",
      },
      {
        dependency: "jscpd",
        reason:
          "cli/clones/jscpd-bin.ts resolves its platform package with Bun.resolveSync and spawns the binary by path",
      },
      {
        dependency: "oxlint-tsgolint",
        reason: "oxlint runs its native binary through OXLINT_TSGOLINT_PATH, resolved by name in cli/scripts/lint.ts",
      },
      {
        dependency: "turbo",
        reason:
          "cli/scripts/turbo-bin.ts resolves its package.json with Bun.resolveSync " +
          "and spawns the platform binary by path",
      },
      {
        dependency: "@workerstack/references",
        reason: "repo sync reads its references/INDEX.md by path for the repo:available section; nothing imports it",
      },
      {
        dependency: "stylelint-config-standard",
        reason: "cli/css/stylelint-config.ts names it in the config's extends, which Stylelint resolves by name",
      },
      {
        dependency: "stylelint-config-recess-order",
        reason: "cli/css/stylelint-config.ts names it in the config's extends, which Stylelint resolves by name",
      },
      {
        dependency: "@dreamsicle.io/stylelint-config-tailwindcss",
        reason: "cli/css/stylelint-config.ts names it in the extends and imports it by a name held in a variable",
      },
      {
        dependency: "stylelint-order",
        reason: "the plugin stylelint-config-recess-order loads by name; pinned here so isolated installs hold it",
      },
      {
        dependency: "@cloudflare/workers-types",
        reason: "optional peer for consumers: the shipped tsconfig/worker.d.ts references its types for them",
      },
    ],
  },
  lint: {
    skip: [
      {
        files: ["cli/sync/apply-migration.ts"],
        reason:
          "the steps run in plan order so a crash after step n leaves only later steps undone " +
          "for the next run to finish",
        rules: ["eslint/no-await-in-loop"],
      },
      {
        files: ["e2e/hosts.e2e.ts", "e2e/init.e2e.ts", "e2e/registry.ts"],
        reason:
          "each loop runs processes in one sandbox in order, or polls until the registry answers, " +
          "so running them at once would change behavior",
        rules: ["eslint/no-await-in-loop"],
      },
      {
        files: ["cli/scripts/workspace-root.ts"],
        reason:
          "a process-wide git rev-parse cache that every hook entry point shares; " +
          "threading it through each caller adds reader load",
        rules: ["repo/no-module-state"],
      },
      {
        files: ["cli/stryker-preload.ts"],
        reason: "bun runs this file with --preload for its one side effect, clearing Error.prepareStackTrace",
        rules: ["repo/no-module-side-effects"],
      },
      {
        files: [
          "dev/agent-tokens.ts",
          "dev/capture-tree-goldens.ts",
          "dev/link-self.ts",
          "dev/move-tmp-paths.ts",
          "dev/oxlint-catalog.ts",
          "dev/reply-voice-stats.ts",
          "dev/rule-ledger.ts",
          "dev/stock-history.ts",
          "dev/sync-pstack-skills.ts",
        ],
        reason:
          "bun runs each file directly; its one module-scope statement is the import.meta.main guard that calls run",
        rules: ["repo/no-module-side-effects"],
      },
      {
        files: ["e2e/setup.ts"],
        reason: "vitest's ProvidedContext is augmented through declare module and only an interface merges",
        rules: ["typescript/consistent-type-definitions"],
      },
      {
        files: ["dev/vitest-setup.ts"],
        reason: "the vitest setup file runs once per test process for its effects: it prepares the environment",
        rules: ["repo/env-in-config", "repo/no-module-side-effects"],
      },
      {
        files: ["presets/temp-root-env.ts"],
        reason:
          "the temp root env reads NODE_COMPILE_CACHE once so test processes keep the real compile cache " +
          "while their temp dir is the run root",
        rules: ["repo/env-in-config"],
      },
    ],
  },
  nightly: { shards: 8 },
  owner: { github: "lovrozagar", name: "Lovro Žagar" },
  packs: ["agents", "standards", "docs", "release", "benchmark"],
});
