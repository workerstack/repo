import { defineConfig } from "./presets/vitest.ts";

/**
 * Packed-tarball e2e: real registry, real package managers, real consumer repos. The preset adds the temp root
 * guard ahead of `e2e/setup.ts`; the run has no coverage, so its floors never apply.
 */
export default defineConfig({
  test: {
    unstubEnvs: true,
    include: ["e2e/**/*.e2e.ts"],
    globalSetup: ["e2e/setup.ts"],
    testTimeout: 900_000,
    hookTimeout: 600_000,
    fileParallelism: false,
    maxConcurrency: 1,
  },
});
