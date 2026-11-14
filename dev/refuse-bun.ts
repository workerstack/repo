/**
 * The globalSetup of `vitest.node.config.ts`. oxlint's `RuleTester` refuses Bun, so a run of that config under Bun
 * (`bunx --bun vitest -c vitest.node.config.ts`) would fail every rule test for no real reason.
 */
const MESSAGE = "vitest.node.config.ts runs on node; run node --run test:node";

/** Throws, naming the command to run, when `versions` is Bun's. */
export function refuseBun(versions: Readonly<Partial<Record<string, string>>>): void {
  if (versions["bun"] !== undefined) throw new Error(MESSAGE);
}

/** Vitest runs this once, before any test file. */
export function setup(): void {
  refuseBun(process.versions);
}
