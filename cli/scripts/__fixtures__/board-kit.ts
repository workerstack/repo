import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach } from "vitest";
import { note } from "../board.ts";
import type { BoardRow, NoteOptions, ProcessInfo } from "../board.types.ts";
import { removeTemps } from "../../__fixtures__/remove-temps.ts";

const homes: string[] = [];
afterEach(() => {
  removeTemps(homes.splice(0));
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

/** A probe that finds pid 30's process for every pid asked. */
export function alive(): ProcessInfo {
  return { comm: "claude", pid: 30, ppid: 1, start: "100" };
}

/** Notes the `sid` session's row in `dir` as pid 30, with `extra` over the defaults. */
export function writeRow(dir: string, extra: Partial<NoteOptions> = {}): BoardRow | null {
  return note({
    boot: BOOT,
    cwd: "/home/user/x",
    effort: "medium",
    home: dir,
    model: "fable 51",
    now: "2026-10-09T12:00:00Z",
    pid: 30,
    probe: alive,
    provider: "claude",
    session: "sid",
    start: "100",
    work: "updating auth",
    ...extra,
  });
}
