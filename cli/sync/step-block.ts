import { PREFIX } from "./migrate.constants.ts";
import { conflictLines, type MigrationStep } from "./migrate.ts";

/**
 * One block of steps sync runs before it writes: what the pending line calls them, the steps, and whether the config
 * is read again after.
 */
export type StepBlock = { noun: string; steps: readonly MigrationStep[]; reload?: boolean };

/** What a block needs from the sync run around it. */
export type StepRun = {
  check: boolean;
  postinstall: boolean;
  stderr: (s: string) => void;
  /** Applies the steps and prints their lines; throws when one fails. */
  apply: (steps: readonly MigrationStep[]) => Promise<void>;
  /** Prints the errors and returns the exit code. */
  fail: (errors: string[]) => number;
  /** Plans the outputs again, after reading the config again when `reload`; the exit code if that fails, else null. */
  replan: (reload: boolean) => Promise<number | null>;
};

/** How a block ended: sync stops with `exit`, or goes on, having `applied` steps or found none. */
export type StepResult = { exit: number } | { applied: boolean };

/**
 * Runs one block: a conflict stops it, `--check` names each step that says what it would do, reports the pending count
 * and exits 1, otherwise the steps are applied and the outputs planned again from what they changed. No steps, nothing
 * happens.
 */
export async function stepBlock(block: StepBlock, run: StepRun): Promise<StepResult> {
  const { steps } = block;
  const conflicts = conflictLines(steps);
  if (conflicts.length > 0) {
    for (const line of conflicts) run.stderr(`${line}\n`);
    return { exit: run.postinstall ? 0 : 1 };
  }
  if (steps.length === 0) return { applied: false };
  if (run.check) {
    for (const line of pendingLines(block)) run.stderr(`${line}\n`);
    return { exit: 1 };
  }
  try {
    await run.apply(steps);
  } catch (error) {
    return { exit: run.fail([(error /* the fs and git calls of a step throw only Errors */ as Error).message]) };
  }
  const replanned = await run.replan(block.reload === true);
  return replanned === null ? { applied: true } : { exit: replanned };
}

/** The `--check` lines of a block: each step that says what it would do, then the pending count. */
function pendingLines({ noun, steps }: StepBlock): string[] {
  const named = steps.flatMap((step) => (step.kind === "handover" ? [`${PREFIX}${step.pending}`] : []));
  return [
    ...named,
    `${PREFIX}${steps.length} ${noun} step${steps.length === 1 ? "" : "s"} pending; run \`bun repo sync\``,
  ];
}
