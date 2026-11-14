/**
 * The typecheck step of `repo turn`: each owner's tsconfig.json and its strict tsconfig.src.json, all at once, each
 * incremental with the store `repo ci` keeps.
 */
import fs from "node:fs";
import path from "node:path";

import { missingSrcConfig } from "../check-tsconfig.ts";
import { RUNTIME_CONFIG, SRC_CONFIG } from "../tsconfig.constants.ts";
import type { Captured } from "./lint.ts";
import { dirName, failed, owners, passed, type StepResult, type Turn } from "./turn-steps.ts";
import { tscArgs } from "./typecheck-gate.ts";

/** A config typecheck ran or found missing: its root-relative path as the label names it, and what to print. */
type ConfigRun = { name: string; ok: boolean; output: string };

function configRun(name: string, run: Captured): ConfigRun {
  return {
    name,
    ok: run.code === 0,
    output: `${run.stdout}${run.stderr}`,
  };
}

/** The owner's tsconfig.json and its tsconfig.src.json at once; a missing src config fails with check's message. */
async function typecheckOwner(turn: Turn, owner: string): Promise<ConfigRun[]> {
  async function tsc(config: string) {
    return configRun(config, await turn.bins.tsc(tscArgs(config), turn.root));
  }

  const runtime = path.posix.join(owner, RUNTIME_CONFIG);
  const src = path.posix.join(owner, SRC_CONFIG);

  if (!fs.existsSync(path.join(turn.root, src))) {
    const output = `repo ${turn.command}: ${missingSrcConfig(dirName(owner))}\n`;

    return [await tsc(runtime), { name: `${src} missing`, ok: false, output }];
  }

  return await Promise.all([tsc(runtime), tsc(src)]);
}

/**
 * Incremental `tsc --noEmit -p`, all at once, on the tsconfig.json and the strict tsconfig.src.json of each owning
 * package with a tsconfig.json, the root for files outside packages. A failure names each failing config by path.
 */
export async function typecheckStep(turn: Turn): Promise<StepResult | null> {
  const checked = owners(turn).filter((owner) => fs.existsSync(path.join(turn.root, owner, RUNTIME_CONFIG)));

  if (checked.length === 0) return passed("typecheck skipped (no tsconfig.json)");
  const runs = await Promise.all(checked.map((owner) => typecheckOwner(turn, owner)));
  const bad = runs.flat().filter((run) => !run.ok);

  if (bad.length === 0) return passed(`typecheck ${checked.map(dirName).join(", ")}`);
  const names = bad.map(({ name }) => name).toSorted();

  return failed(
    `typecheck failed (${names.join(", ")})`,
    bad.map(({ output }) => output),
  );
}
