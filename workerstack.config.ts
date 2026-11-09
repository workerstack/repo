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
    ],
  },
});
