---
name: import-meta-resolve-dropped-under-vitest
paths: ["cli/release/main.ts","cli/release/consumer.ts","cli/scripts/lint.ts"]
hits: 1
last-hit: 2026-11-10
evidence: ["plan 60"]
---

# import.meta.resolve fails under vitest

Code that tests run in-process resolved a package with `import.meta.resolve`, and the tests failed on Windows CI with `Cannot find package 'typescript'`.

## Mistake
`fileURLToPath(import.meta.resolve("typescript/lib/tsc.js"))` worked in a local bun run. Vitest's transform drops `import.meta.resolve`, so in-process tests resolved from the wrong place. `cli/scripts/lint.ts` already documented this.

## Fix
Resolve with `Bun.resolveSync(specifier, import.meta.dirname)`, in one shared helper. Keep `import.meta.resolve` only in source that runs in a real bun child process, never in vitest.
