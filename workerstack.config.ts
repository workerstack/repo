import { defineConfig } from "@workerstack/repo";

export default defineConfig({
  packs: ["agents", "standards", "docs"],
  agents: { skills: ["google-workspace", "listen", "speak", "clasp"] },
  knip: {
    ignore: [
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
        dependency: "@cloudflare/workers-types",
        reason: "optional peer for consumers: the shipped tsconfig/worker.d.ts references its types for them",
      },
    ],
  },
  lint: {
    skip: [
      {
        files: ["dev/vitest-setup.ts"],
        rules: ["repo/env-in-config"],
        reason: "the vitest setup file prepares the test process environment once for every test",
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
