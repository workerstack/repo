import { defineConfig } from "vitest/config";

/** Packed-tarball e2e: real registry, real package managers, real consumer repos. */
export default defineConfig({
  test: {
    unstubEnvs: true,
    include: ["e2e/**/*.e2e.ts"],
    globalSetup: ["e2e/setup.ts"],
    testTimeout: 900_000,
    hookTimeout: 600_000,
    fileParallelism: false,
    maxConcurrency: 1,
    // Bun module namespaces carry `__esModule`; the default interop would swap a namespace (zod's) for its default.
    deps: { interopDefault: false },
    // globalSetup loads cli/env.ts in the runner process, where an external zod loses its named exports.
    server: { deps: { inline: ["zod"] } },
  },
});
