import type { Gate, Parsed } from "./gate-run.ts";
/**
 * `repo precommit`: the commit's gate, which the pre-commit hook runs. It gates the index with every step `repo turn`
 * runs, related tests before check, and restages what a step rewrote.
 */
import { testsStep } from "./tests-step.ts";
import { checkStep } from "./turn-steps.ts";
import { gateMain, SHARED, type TurnDeps } from "./turn.ts";

/** Always the index; precommit takes no arguments. */
function parsePrecommit(argv: readonly string[]): Parsed {
  if (argv.length > 0) return { errors: ["takes no arguments; use repo precommit"], ok: false };

  return { ok: true, scope: { kind: "staged" } };
}

const PRECOMMIT: Gate = { ...SHARED, after: [testsStep, checkStep], name: "precommit", parse: parsePrecommit };

export function main(argv: string[], deps: TurnDeps = {}): Promise<number> {
  return gateMain(PRECOMMIT, argv, deps);
}
