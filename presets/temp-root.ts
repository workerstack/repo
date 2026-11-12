import fs from "node:fs";
import path from "node:path";

import { repoEnv } from "../cli/repo-env.ts";
import { rootPath } from "./temp-root-env.ts";
import { BUN_SHIM_PREFIX, PERMISSION_DENIED } from "./temp-root.constants.ts";

/**
 * Vitest globalSetup: every run gets its own temp root, so a test that leaves a dir behind fails the run and a
 * crashed run's root is removed by the next one. `defineConfig` gives test processes the root as TMPDIR, TEMP and
 * TMP (`rootEnv`); this process keeps the real temp dir, so its own tooling never counts as a leak.
 */
const FAILED = 1;
const ROOT_PID_RE = /^repo-test-(\d+)$/;

/** `repo-test-<pid>` names give the pid; anything else is not ours. */
function pidOf(name: string): number | undefined {
  const match = ROOT_PID_RE.exec(name);

  return match?.[1] === undefined ? undefined : Number(match[1]);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch (error) {
    // EPERM: the pid exists but belongs to someone else.
    return error instanceof Error && "code" in error && error.code === PERMISSION_DENIED;
  }
}

/** Removes the roots whose run is gone; a second call finds nothing and does nothing. */
function removeDeadRoots(base: string): void {
  for (const name of fs.readdirSync(base)) {
    const pid = pidOf(name);

    if (pid !== undefined && !isAlive(pid)) fs.rmSync(path.join(base, name), { force: true, recursive: true });
  }
}

export function leakMessage(names: string[]): string {
  // Shipped as ES2022 without the cli helpers: a sorted copy in code-unit order.
  const sorted = [...names];
  sorted.sort((a, b) => Number(a > b) - Number(a < b));
  const list = sorted.join(", ");
  const noun = names.length === 1 ? "entry" : "entries";

  return `tests left ${names.length} ${noun} in the run's temp root: ${list}; remove each in the test that made it`;
}

/** Ends the run: keeps the root when asked, otherwise removes it and fails when it was not empty. */
function finish(root: string): void {
  if ((repoEnv.process.REPO_E2E_KEEP ?? "") !== "") {
    process.stdout.write(`kept temp root: ${root}\n`);

    return;
  }

  const left = fs.readdirSync(root).filter((name) => !name.startsWith(BUN_SHIM_PREFIX));
  fs.rmSync(root, { force: true, recursive: true });

  if (left.length === 0) return;
  process.exitCode = FAILED;
  process.stderr.write(`Error: ${leakMessage(left)}\n`);
}

export function setup(): () => void {
  const root = rootPath();
  removeDeadRoots(path.dirname(root));
  // A live pid's root is this run's own; one left by an earlier process with the same pid is stale.
  fs.rmSync(root, { force: true, recursive: true });
  fs.mkdirSync(root);

  return () => finish(root);
}
