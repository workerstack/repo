import { coverageConfigDefaults } from "vitest/config";
import { defineConfig } from "./presets/vitest.ts";

export default defineConfig({
  test: {
    unstubEnvs: true,
    include: ["cli/**/*.test.ts", "dev/**/*.test.ts", "presets/**/*.test.ts"],
    setupFiles: ["dev/vitest-setup.ts"],
    coverage: {
      include: ["cli/**", "presets/**"],
      // Fixtures are copies of other repos' files, read by tests and never run.
      exclude: [...coverageConfigDefaults.exclude, "**/fixtures/**"],
      // json-summary feeds `bun repo coverage`.
      reporter: [...coverageConfigDefaults.reporter, "json-summary"],
      // The preset adds the per-file floors of coverage-floors.json, which `bun repo coverage` raises and never
      // lowers; these globs hold everything but cli/scripts at 100%.
      thresholds: {
        "{cli/!(scripts)/**,cli/*,presets/**}": {
          perFile: true,
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
      },
    },
  },
});
