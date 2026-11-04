import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [".rulesync/scripts/**/*.test.ts", "cli/**/*.test.ts", "dev/**/*.test.ts"],
    setupFiles: ["dev/vitest-setup.ts"],
    // A Windows runner spawns node and git 25-35x slower than Linux, and hook tests spawn dozens of each.
    testTimeout: process.platform === "win32" ? 60_000 : 5_000,
    coverage: {
      provider: "v8",
      include: ["cli/**"],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});
