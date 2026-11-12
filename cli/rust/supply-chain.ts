import fs from "node:fs";
import path from "node:path";

import type { Pack } from "../config.ts";
import { runGit, type GitRun } from "../sync/standards.ts";
import { crateProblems } from "./cargo-metadata.ts";
import { DENY_PIN, SHEAR_PIN } from "./cargo-tools.constants.ts";
import { denyProblems, pinProblem } from "./cargo-tools.ts";
import { LOCK_FILE, MISSING_CARGO } from "./clippy.constants.ts";
import { runCargo, type CargoRun } from "./clippy.ts";
import { shearProblems } from "./shear-problems.ts";
import { TOOLS_PACK, UNTRACKED_LOCK } from "./supply-chain.constants.ts";

/** The cargo and git runs `supplyChainAt` makes; tests hand it their own. */
export type SupplyChainDeps = { run?: CargoRun; git?: GitRun };

/** Why git cannot say whether the lock is tracked, or that it is not; `null` when it is tracked. */
function untrackedLock(root: string, git: GitRun): string | null {
  const listed = git(root, ["ls-files", "--cached", "--", LOCK_FILE]);

  if (listed.status !== 0) return `git ls-files failed (exit ${listed.status}): ${listed.stderr.trim()}`;

  return listed.stdout.trim() === "" ? UNTRACKED_LOCK : null;
}

/** The pin problems, and the problems of each tool whose pin is sound. */
function toolProblems(root: string, run: CargoRun, unlicensed: ReadonlySet<string>): string[] {
  const deny = pinProblem(root, run, DENY_PIN);
  const shear = pinProblem(root, run, SHEAR_PIN);

  return [
    ...(deny === null ? [] : [deny]),
    ...(shear === null ? [] : [shear]),
    ...(deny === null ? denyProblems(root, run, unlicensed) : []),
    ...(shear === null ? shearProblems(root, run) : []),
  ];
}

/**
 * The supply-chain problems of the Rust repo at `root`: an untracked Cargo.lock, then (under the standards pack)
 * crates that cannot publish, tool pins, cargo-deny errors and cargo-shear findings. A missing lock, a stale lock and a
 * missing cargo are clippy's lines, so they add nothing here. A repo with no root Cargo.toml has none.
 */
export function supplyChainAt(root: string, packs: readonly Pack[], deps: SupplyChainDeps = {}): string[] {
  if (!fs.existsSync(path.join(root, "Cargo.toml")) || !fs.existsSync(path.join(root, LOCK_FILE))) return [];
  const run = deps.run ?? runCargo;
  const lines: string[] = [];
  const untracked = untrackedLock(root, deps.git ?? runGit);

  if (untracked !== null) lines.push(untracked);

  if (!packs.includes(TOOLS_PACK)) return lines;
  const crates = crateProblems(root, run);

  if (crates.kind === "stale") return lines;
  lines.push(...crates.problems.filter((line) => line !== MISSING_CARGO));

  return crates.kind === "failed" ? lines : [...lines, ...toolProblems(root, run, crates.unlicensed)];
}
