/** The real git and gh runners of `repo ci wait`, and its real sleep. */
import { spawnSync } from "node:child_process";

import { childEnv } from "../env.ts";
import type { Captured } from "./lint.ts";
import { toolEnv } from "./tool-env.ts";

/** Runs a tool with `args` in a directory, its output captured. */
export type Runner = (args: string[], cwd: string) => Captured;

/** A runner of `bin`; a tool that cannot start is a failed run with the reason as its stderr. */
export function spawnRunner(bin: string): Runner {
  return (args, cwd) => {
    const result = spawnSync(bin, args, { cwd, encoding: "utf8", env: toolEnv(childEnv()) });

    if (result.error !== undefined) return { code: 1, stderr: result.error.message, stdout: "" };

    return { code: result.status ?? 1, stderr: result.stderr, stdout: result.stdout };
  };
}

/** A runner of `bin` that shares this process's terminal, so the tool can prompt and its output is not captured. */
export function inheritRunner(bin: string): Runner {
  return (args, cwd) => {
    const result = spawnSync(bin, args, { cwd, env: toolEnv(childEnv()), stdio: "inherit" });

    if (result.error !== undefined) return { code: 1, stderr: result.error.message, stdout: "" };

    return { code: result.status ?? 1, stderr: "", stdout: "" };
  };
}

export function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
