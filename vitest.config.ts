import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["scripts/**/*.test.ts", "cli/**/*.test.ts"],
    testTimeout: process.platform === "win32" ? 20_000 : 5_000,
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
