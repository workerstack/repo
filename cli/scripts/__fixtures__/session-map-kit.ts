// The session-map suites' helpers: temp repos, the hook run in-process, its parsed answer and linked worktrees.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, vi } from "vitest";

import { main as sessionMain } from "../session-map.ts";
import { runHook } from "./run-hook.ts";
import { removeTemps } from "../../__fixtures__/remove-temps.ts";

export type MapOutput = {
  hookSpecificOutput: { hookEventName: string; additionalContext: string };
};

export type BoardRow = {
  session: string;
  work: string;
  provider: string;
  pid: number;
  start: string;
  boot: string;
};

const tmpDirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  removeTemps(tmpDirs.splice(0));
});

export function tmp(git: boolean) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "session-map-"));
  tmpDirs.push(root);
  if (git) spawnSync("git", ["init", "-q"], { cwd: root });
  return root;
}

export const HOOK_ENV = {
  CLAUDE_PROJECT_DIR: undefined,
  GROK_HOOK_EVENT: undefined,
  GROK_SESSION_ID: undefined,
  GROK_WORKSPACE_ROOT: undefined,
  REPO_BOARD_PROVIDER: "claude",
};

/** Runs the hook in-process as if the host started it in `root`. */
export function run(root: string, stdin: string, boardHome = tmpBoard()) {
  const cwd = vi.spyOn(process, "cwd").mockReturnValue(root);
  try {
    return runHook(sessionMain, stdin, { ...HOOK_ENV, REPO_BOARD_HOME: boardHome });
  } finally {
    cwd.mockRestore();
  }
}

export const tmpBoard = () => tmp(false);

/** The context of the hook's answer: one SessionStart object on stdout. */
export function mapOf(stdout: string): MapOutput {
  return JSON.parse(stdout) /* the hook prints one SessionStart answer */ as MapOutput;
}

export function worktree(withOwnInstall: boolean) {
  const main = fs.realpathSync(tmp(true));
  const git = (...a: string[]) =>
    spawnSync("git", ["-c", "user.email=a@b", "-c", "user.name=a", ...a], { cwd: main, encoding: "utf8" });
  git("commit", "-q", "--allow-empty", "-m", "i");
  const wt = path.join(main, "..", `${path.basename(main)}-wt`);
  git("worktree", "add", "-q", wt);
  tmpDirs.push(wt);
  for (const dir of withOwnInstall ? [main, wt] : [main]) {
    fs.mkdirSync(path.join(dir, "node_modules", ".bin"), { recursive: true });
    fs.writeFileSync(path.join(dir, "node_modules", ".bin", "repo"), "");
  }
  fs.mkdirSync(path.join(wt, "src"), { recursive: true });
  fs.writeFileSync(path.join(wt, "src", "a.ts"), "");
  return { main, wt };
}
export const ctxOf = (stdout: string) => mapOf(stdout).hookSpecificOutput.additionalContext;
