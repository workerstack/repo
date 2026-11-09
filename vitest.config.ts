import { coverageConfigDefaults } from "vitest/config";
import { defineConfig } from "./presets/vitest.ts";
import floors from "./cli/scripts/coverage-floors.json" with { type: "json" };

export default defineConfig({
  test: {
    unstubEnvs: true,
    include: ["cli/**/*.test.ts", "dev/**/*.test.ts", "presets/**/*.test.ts"],
    globalSetup: ["dev/temp-root.ts"],
    // globalSetup loads cli/env.ts in the runner process, where an external zod loses its named exports.
    server: { deps: { inline: ["zod"] } },
    setupFiles: ["dev/vitest-setup.ts"],
    coverage: {
      include: ["cli/**", "presets/**"],
      // Fixtures are copies of other repos' files, read by tests and never run.
      exclude: [...coverageConfigDefaults.exclude, "**/fixtures/**"],
      // json-summary feeds `bun dev/coverage-floors.ts`.
      reporter: [...coverageConfigDefaults.reporter, "json-summary"],
      // Everything is held at 100% except cli/scripts, whose files each keep the floor `dev/coverage-floors.ts`
      // measured and never lowers.
      thresholds: {
        "{cli/!(scripts)/**,cli/*,presets/**}": { lines: 100, functions: 100, branches: 100, statements: 100 },
        ...floors,
      },
    },
  },
});
