import { defineConfig } from "vitest/config";

/** Packed-tarball e2e: real registry, real package managers, real consumer repos. */
export default defineConfig({
  test: {
    include: ["e2e/**/*.e2e.ts"],
    globalSetup: ["e2e/setup.ts"],
    testTimeout: 900_000,
    hookTimeout: 600_000,
    fileParallelism: false,
    maxConcurrency: 1,
  },
});
