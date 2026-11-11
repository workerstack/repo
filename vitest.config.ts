import { coverageConfigDefaults } from "vitest/config";

import { FULL_COVERAGE } from "./full-coverage.constants.ts";
import { defineConfig } from "./presets/vitest.ts";

export default defineConfig({
  test: {
    coverage: {
      // Fixtures are copies of other repos' files, read by tests and never run.
      exclude: [...coverageConfigDefaults.exclude, "**/fixtures/**"],
      include: ["cli/**", "presets/**"],
      // json-summary feeds `bun repo coverage`.
      reporter: [...coverageConfigDefaults.reporter, "json-summary"],
      // The preset adds the per-file floors of coverage-floors.json, which `bun repo coverage` raises and never
      // lowers; this glob holds all of cli and presets at 100% per file.
      thresholds: {
        "{cli/**,presets/**}": {
          branches: FULL_COVERAGE,
          functions: FULL_COVERAGE,
          lines: FULL_COVERAGE,
          perFile: true,
          statements: FULL_COVERAGE,
        },
      },
    },
    include: ["cli/**/*.test.ts", "dev/**/*.test.ts", "presets/**/*.test.ts"],
    setupFiles: ["dev/vitest-setup.ts"],
    unstubEnvs: true,
  },
});
