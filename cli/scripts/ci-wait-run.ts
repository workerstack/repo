/** The real git and gh runners of `repo ci wait`, and its real sleep. */
import { spawnSync } from "node:child_process";
import { childEnv } from "../env.ts";
import { toolEnv } from "./lint.ts";
import type { Captured } from "./lint.ts";

/** Runs a tool with `args` in a directory, its output captured. */
export type Runner = (args: string[], cwd: string) => Captured;

/** A runner of `bin`; a tool that cannot start is a failed run with the reason as its stderr. */
export const spawnRunner =
  (bin: string): Runner =>
  (args, cwd) => {
    const result = spawnSync(bin, args, { cwd, encoding: "utf8", env: toolEnv(childEnv()) });
    if (result.error) return { code: 1, stdout: "", stderr: result.error.message };
    return { code: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
  };

export const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
