import { defineConfig } from "./presets/vitest.ts";

/**
 * Packed-tarball e2e: real registry, real package managers, real consumer repos. The preset adds the temp root
 * guard ahead of `e2e/setup.ts`; the run has no coverage, so its floors never apply.
 */
export default defineConfig({
  test: {
    fileParallelism: false,
    globalSetup: ["e2e/setup.ts"],
    hookTimeout: 600_000,
    include: ["e2e/**/*.e2e.ts"],
    maxConcurrency: 1,
    testTimeout: 900_000,
    unstubEnvs: true,
  },
});
