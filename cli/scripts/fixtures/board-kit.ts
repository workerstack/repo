import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach } from "vitest";
import type { ProcessInfo } from "../board.ts";

const homes: string[] = [];
afterEach(() => {
  for (const dir of homes.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A fresh planted home, removed after the case. */
export function plantHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "repo-board-"));
  homes.push(dir);
  return dir;
}

/** The directory board rows live in under a planted home. */
export function rowsDir(home: string): string {
  return path.join(home, ".workerstack", "board");
}

/** Plants one raw row file, as an older or foreign writer would have left it. */
export function plantRowFile(home: string, name: string, text: string): string {
  const dir = rowsDir(home);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, text);
  return file;
}

export const BOOT = "boot-a";

/** A probe that knows the given processes and reports every other pid as gone. */
export function probeOf(known: Record<number, Partial<ProcessInfo>>) {
  return (pid: number): ProcessInfo | null => {
    const hit = known[pid];
    return hit ? { pid, start: "100", comm: "claude", ppid: 1, ...hit } : null;
  };
}
