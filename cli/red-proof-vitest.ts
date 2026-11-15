import { spawnSync } from "node:child_process";

import { childEnv } from "./env.ts";
import { MAX_BUFFER, NOT_FOUND } from "./red-proof.constants.ts";
import { type TestRun, missingNode, vitestCommand } from "./scripts/node-run.ts";
import { toolEnv } from "./scripts/tool-env.ts";
import type { GitRun } from "./sync/standards.ts";

/** Which run of a package's tests to start, and how long it may take before it is stopped. */
export type VitestLimits = { run: TestRun; timeoutMs: number };

/** Runs vitest with `args` (after the binary) in `cwd`; a run that did not finish in time has a non-zero code. */
export type VitestRun = (args: string[], cwd: string, limits: VitestLimits) => { code: number; stderr: string };

/**
 * Vitest from the package at `cwd`, the main run under bun and the node run on node, as the package's own tests run;
 * null-free: a run that ends early reports why.
 */
export function runVitest(args: string[], cwd: string, { run, timeoutMs }: VitestLimits): ReturnType<VitestRun> {
  const command = vitestCommand(cwd, run, args);

  if (command === null) return { code: 1, stderr: `cannot resolve vitest from ${cwd}` };
  const [bin, argv] = run === "node" ? ["node", command] : [process.execPath, ["--bun", ...command]];

  const result = spawnSync(bin, argv, {
    cwd,
    encoding: "utf8",
    env: toolEnv(childEnv({ NO_COLOR: "1" })),
    maxBuffer: MAX_BUFFER,
    timeout: timeoutMs,
  });

  const { error } = result;

  if (error !== undefined && "code" in error && error.code === NOT_FOUND)
    return { code: 1, stderr: missingNode("red-proof", undefined) };

  if (error !== undefined) return { code: 1, stderr: `vitest did not finish within ${timeoutMs}ms (${error.message})` };

  return { code: result.status /* null only when result.error is set */ as number, stderr: result.stderr };
}

/** Unpacks a tar file into `cwd`; shaped like a git runner so a failure reads the same. */
export function untar(cwd: string, args: readonly string[]): ReturnType<GitRun> {
  const result = spawnSync("tar", [...args], { cwd, encoding: "utf8" });

  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}
