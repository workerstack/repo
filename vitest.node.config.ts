import { coverageConfigDefaults } from "vitest/config";

import { FULL_COVERAGE } from "./full-coverage.constants.ts";
import { defineConfig } from "./presets/vitest.ts";

/** The lint rule tests: oxlint's `RuleTester` runs only on Node, so they run here, apart from the Bun suite. */
export default defineConfig({
  test: {
    coverage: {
      exclude: [...coverageConfigDefaults.exclude, "**/__fixtures__/**"],
      include: ["cli/lint/**/*.ts"],
      reporter: [coverageConfigDefaults.reporter, "json-summary"].flat(),
      reportsDirectory: "coverage/node",
      thresholds: {
        "cli/lint/**": {
          branches: FULL_COVERAGE,
          functions: FULL_COVERAGE,
          lines: FULL_COVERAGE,
          perFile: true,
          statements: FULL_COVERAGE,
        },
      },
    },
    // Refuses a run under Bun before any test starts.
    globalSetup: ["dev/refuse-bun.ts"],
    include: ["cli/lint/**/*.test.ts"],
    // oxlint's RuleTester reserves one ~6 GiB buffer per process, which win32 commits: a 16 GB runner fits one worker.
    maxWorkers: process.platform === "win32" ? 1 : undefined,
    setupFiles: ["dev/vitest-setup.ts"],
    unstubEnvs: true,
  },
});
