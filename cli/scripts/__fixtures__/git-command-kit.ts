/** Helpers for suites that run a `repo` command's `main` against a temp git repo. */
import { execFileSync } from "node:child_process";

import { vi } from "vitest";

/** Runs git in `cwd` as a throwaway author; returns its trimmed stdout. */
export function gitIn(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, encoding: "utf8" }).trim();
}

/** Calls `run` with stdout and stderr captured, then restores both; returns its exit code and what each got. */
export function captureMain(run: () => number): { code: number; err: string; out: string } {
  const out: string[] = [];
  const err: string[] = [];
  const spies = [
    vi.spyOn(process.stdout, "write").mockImplementation((s) => (out.push(String(s)), true)),
    vi.spyOn(process.stderr, "write").mockImplementation((s) => (err.push(String(s)), true)),
  ];

  try {
    return { code: run(), err: err.join(""), out: out.join("") };
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
}
