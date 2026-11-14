/**
 * A globalSetup of this repo's vitest configs. The code under test calls `Bun.*`, so a run under Node (`bunx vitest`
 * or `npx vitest` where node is on PATH, since vitest's bin has a node shebang) fails a dozen tests for no real
 * reason. CI never sees it: it removes node from PATH, and the shebang falls back to bun.
 */
const MESSAGE =
  "the tests need the Bun runtime, and vitest is running under Node; run `bun run test` (bun --bun vitest run)";

/** Throws, naming the command to run, unless `versions` is Bun's. */
export function refuseNode(versions: Readonly<Partial<Record<string, string>>>): void {
  if (versions["bun"] === undefined) throw new Error(MESSAGE);
}

/** Vitest runs this once, before any test file. */
export function setup(): void {
  refuseNode(process.versions);
}
