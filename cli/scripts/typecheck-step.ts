/** The typecheck step of `repo turn`: each owner's tsconfig.json, then its strict tsconfig.src.json. */
import fs from "node:fs";
import path from "node:path";

import { missingSrcConfig } from "../check-tsconfig.ts";
import { RUNTIME_CONFIG, SRC_CONFIG } from "../tsconfig.constants.ts";
import type { Captured } from "./lint.ts";
import { dirName, failed, owners, passed, type StepResult, type Turn } from "./turn-steps.ts";

/** A config typecheck ran or found missing: its root-relative path as the label names it, and what to print. */
type ConfigRun = { name: string; ok: boolean; output: string };

function configRun(name: string, run: Captured): ConfigRun {
  return {
    name,
    ok: run.code === 0,
    output: `${run.stdout}${run.stderr}`,
  };
}

/** The owner's tsconfig.json, then its tsconfig.src.json, which is a failure with check's message when missing. */
function typecheckOwner(turn: Turn, owner: string): ConfigRun[] {
  function tsc(project: string) {
    return turn.bins.tsc(["--noEmit", "-p", project], turn.root);
  }

  const runtime = configRun(path.posix.join(owner, RUNTIME_CONFIG), tsc(dirName(owner)));
  const src = path.posix.join(owner, SRC_CONFIG);

  if (!fs.existsSync(path.join(turn.root, src)))
    return [runtime, { name: `${src} missing`, ok: false, output: `repo turn: ${missingSrcConfig(dirName(owner))}\n` }];

  return [runtime, configRun(src, tsc(src))];
}

/**
 * `tsc --noEmit -p` on the tsconfig.json and the strict tsconfig.src.json of each owning package with a
 * tsconfig.json, the root for files outside packages. A failure names each failing config by path.
 */
export function typecheckStep(turn: Turn): StepResult | null {
  const checked = owners(turn).filter((owner) => fs.existsSync(path.join(turn.root, owner, RUNTIME_CONFIG)));

  if (checked.length === 0) return passed("typecheck skipped (no tsconfig.json)");
  const bad = checked.flatMap((owner) => typecheckOwner(turn, owner)).filter((run) => !run.ok);

  if (bad.length === 0) return passed(`typecheck ${checked.map(dirName).join(", ")}`);
  const names = bad.map(({ name }) => name).toSorted();

  return failed(
    `typecheck failed (${names.join(", ")})`,
    bad.map(({ output }) => output),
  );
}
