import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import { bunPath } from "../../dev/test-paths";
import { childEnv } from "../env.ts";
import { SESSION_REL } from "./browser.constants.ts";
import { liveSessions, runClean } from "./clean-run.ts";
import { nestedHolds } from "./clean-scan.ts";
import { cleanDirs, exists, HOUR, LIVE, NOW, planter, sweepRepo } from "./fixtures/clean-kit.ts";
import { STASH_REL } from "./job.constants.ts";
import { LISTEN_DIR } from "./listen.constants.ts";
import { ORCHESTRATOR_LOGS_DIR } from "./orchestrate.constants.ts";
import { HANDOFF_DIR } from "./persist-handoff.constants.ts";
import { IMPLEMENTATION_DIR } from "./persist-implementation.constants.ts";
import { PLAN_DIR } from "./persist-plan.constants.ts";
import { ROADMAP_DIR } from "./persist-roadmap.constants.ts";
import { TMP_RESERVED_DIRS } from "./persist-tmp.ts";
import { SPEAK_DIR } from "./speak.constants.ts";

const tempDir = cleanDirs();

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, stdio: "ignore" });
}

it("repo clean from a linked worktree cleans the main checkout's scratch", () => {
  const root = fs.realpathSync(tempDir("repo-clean-wt-"));
  git(root, "init", "-q");
  fs.writeFileSync(path.join(root, ".gitignore"), ".tmp/\n.worktrees/\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "init");
  git(root, "worktree", "add", "-q", ".worktrees/w", "-b", "wt/w");
  const put = planter(root);
  put(".tmp/repo/old.log", 48 * HOUR);
  put(".tmp/repo/plans/1-a-20261103T000000Z.md", 48 * HOUR);
  const cli = fileURLToPath(new URL("../../bin/repo.ts", import.meta.url));
  execFileSync(bunPath(), [cli, "clean"], {
    cwd: path.join(root, ".worktrees/w"),
    env: childEnv({ REPO_BOARD_HOME: tempDir("repo-clean-wt-board-") }),
    stdio: "ignore",
  });
  expect(exists(root)(".tmp/repo/old.log")).toBe(false);
  expect(exists(root)(".tmp/repo/plans/1-a-20261103T000000Z.md")).toBe(true);
});

it("repo clean: every repo-owned dir constant is in the reserved set", () => {
  const owned = [
    PLAN_DIR,
    ROADMAP_DIR,
    HANDOFF_DIR,
    IMPLEMENTATION_DIR,
    STASH_REL,
    SESSION_REL,
    ORCHESTRATOR_LOGS_DIR,
    LISTEN_DIR,
    SPEAK_DIR,
  ].map((d) => path.posix.basename(d));
  expect(new Set([...owned, "sessions"])).toStrictEqual(TMP_RESERVED_DIRS);
});

/** Writes a board row for `session` held by this process, as a live host would. */
function boardRow(home: string, session: string): string {
  const board = path.join(home, ".workerstack", "board");
  fs.mkdirSync(board, { recursive: true });
  const stat = fs.readFileSync("/proc/self/stat", "utf8");
  const start = stat
    .slice(stat.lastIndexOf(")") + 1)
    .trim()
    .split(/\s+/)[19];
  const row = path.join(board, `claude-${session}.json`);
  const boot = fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  const fields = { effort: "-", model: "-", provider: "claude", time: "2026-11-03T12:00:00Z" };
  fs.writeFileSync(
    row,
    `${JSON.stringify({ ...fields, boot, cwd: "/x", pid: process.pid, session, start, work: "live" })}\n`,
  );
  return row;
}

it("repo clean reads live sessions without wiping the board", () => {
  if (process.platform !== "linux") return;
  const home = tempDir("repo-clean-board-");
  const row = boardRow(home, LIVE);
  const live = liveSessions({ REPO_BOARD_HOME: home });
  expect(live).toStrictEqual(new Set([LIVE]));
  const root = sweepRepo(tempDir);
  runClean({ dryRun: false, liveSessions: live, now: NOW, out: () => {}, root });
  expect(fs.existsSync(row)).toBe(true);
  expect(exists(root)(`.tmp/repo/sessions/${LIVE}/wrote.txt`)).toBe(true);
});

it("nestedHolds names the first durable dir holding a file", () => {
  const held = tempDir("repo-holds-");
  planter(held)("plans/1-p.md", 0);
  expect(nestedHolds(held)).toBe("plans");
  const loose = tempDir("repo-holds-loose-");
  planter(loose)("x.txt", 0);
  fs.mkdirSync(path.join(loose, "plans"));
  expect(nestedHolds(loose)).toBe(null);
});
