import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { childEnv } from "./env.ts";
import { MAX_BUFFER } from "./red-proof.constants.ts";
import { toolEnv } from "./scripts/tool-env.ts";
import type { GitRun } from "./sync/standards.ts";

/**
 * Runs vitest with `args` (after the binary) in `cwd`, giving up after `timeoutMs`; a run that did not finish has a
 * non-zero code.
 */
export type VitestRun = (args: string[], cwd: string, timeoutMs: number) => { code: number; stderr: string };

/**
 * Vitest from the package at `cwd`, run under bun as the package's own tests would; null-free: a run that ends early
 * reports why.
 */
export function runVitest(args: string[], cwd: string, timeoutMs: number): ReturnType<VitestRun> {
  let manifest: string;

  try {
    manifest = Bun.resolveSync("vitest/package.json", cwd);
  } catch {
    return { code: 1, stderr: `cannot resolve vitest from ${cwd}` };
  }

  const { bin } = JSON.parse(fs.readFileSync(manifest, "utf8")) /* vitest's manifest has a bin map */ as {
    bin: Record<string, string>;
  };

  const script = path.join(path.dirname(manifest), bin["vitest"] /* vitest declares its bin */ as string);

  const result = spawnSync(process.execPath, ["--bun", script, ...args], {
    cwd,
    encoding: "utf8",
    env: toolEnv(childEnv({ NO_COLOR: "1" })),
    maxBuffer: MAX_BUFFER,
    timeout: timeoutMs,
  });

  const { error } = result;

  if (error !== undefined) return { code: 1, stderr: `vitest did not finish within ${timeoutMs}ms (${error.message})` };

  return { code: result.status /* null only when result.error is set */ as number, stderr: result.stderr };
}

/** Unpacks a tar file into `cwd`; shaped like a git runner so a failure reads the same. */
export function untar(cwd: string, args: readonly string[]): ReturnType<GitRun> {
  const result = spawnSync("tar", [...args], { cwd, encoding: "utf8" });

  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}
