import { defineConfig } from "@workerstack/repo";

export default defineConfig({
  packs: ["agents", "standards", "docs"],
  agents: { skills: ["google-workspace", "listen", "speak", "clasp"] },
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
