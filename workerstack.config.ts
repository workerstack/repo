import { defineConfig } from "@workerstack/repo";

export default defineConfig({
  packs: ["agents", "standards", "docs", "release"],
  agents: { skills: ["google-workspace", "listen", "speak", "clasp"] },
  owner: { name: "Lovro Žagar", github: "lovrozagar" },
  nightly: { shards: 8 },
  coverage: { mutate: ["cli/**/*.ts", "presets/**/*.ts"] },
  knip: {
    ignore: [
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
        dependency: "oxfmt",
        reason: "cli/scripts/lint.ts resolves its package.json with Bun.resolveSync and spawns its bin script by path",
      },
      {
        dependency: "oxlint-tsgolint",
        reason: "oxlint runs its native binary through OXLINT_TSGOLINT_PATH, resolved by name in cli/scripts/lint.ts",
      },
      {
        dependency: "turbo",
        reason:
          "cli/scripts/turbo-bin.ts resolves its package.json with Bun.resolveSync and spawns the platform binary by path",
      },
      {
        dependency: "@workerstack/references",
        reason: "repo sync reads its references/INDEX.md by path for the repo:available section; nothing imports it",
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
        files: ["cli/stryker-preload.ts"],
        rules: ["repo/no-module-side-effects"],
        reason: "bun runs this file with --preload for its one side effect, clearing Error.prepareStackTrace",
      },
      {
        files: [
          "dev/agent-tokens.ts",
          "dev/capture-tree-goldens.ts",
          "dev/link-self.ts",
          "dev/reply-voice-stats.ts",
          "dev/rule-ledger.ts",
          "dev/stock-history.ts",
          "dev/sync-pstack-skills.ts",
        ],
        rules: ["repo/no-module-side-effects"],
        reason:
          "bun runs each file directly; its one module-scope statement is the import.meta.main guard that calls run",
      },
      {
        files: ["dev/vitest-setup.ts"],
        rules: ["repo/env-in-config", "repo/no-module-side-effects"],
        reason: "the vitest setup file runs once per test process for its effects: it prepares the environment",
      },
      {
        files: ["presets/temp-root-env.ts"],
        rules: ["repo/env-in-config"],
        reason:
          "the temp root env reads NODE_COMPILE_CACHE once so test processes keep the real compile cache while their temp dir is the run root",
      },
    ],
  },
});
