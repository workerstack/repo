import { defineConfig } from "./presets/vitest.ts";

export default defineConfig({
  test: {
    include: [".rulesync/scripts/**/*.test.ts", "cli/**/*.test.ts", "dev/**/*.test.ts", "presets/**/*.test.ts"],
    setupFiles: ["dev/vitest-setup.ts"],
    coverage: {
      include: ["cli/**", "presets/**"],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});
