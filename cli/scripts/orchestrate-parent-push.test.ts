import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { runHook } from "./fixtures/run-hook.ts";
import { main } from "./orchestrate-parent.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { force: true, recursive: true });
});

function temp(prefix = "push-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function plant(ws: string, rel: string, text: string): string {
  const file = path.join(ws, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

/** The reply fields these cases read. */
interface Reply {
  decision?: string;
  reason?: string;
}

function send(ws: string, payload: Record<string, unknown>): Reply | null {
  const run = runHook(main, { cwd: ws, ...payload }, { CLAUDE_PROJECT_DIR: ws, REPO_BOARD_HOME: temp("board-") });
  expect(run.status).toBe(0);
  return run.stdout ? (JSON.parse(run.stdout) /* the hook prints the shape Reply names */ as Reply) : null;
}

const stop = (ws: string, sid: string, extra: Record<string, unknown>) =>
  send(ws, { hook_event_name: "Stop", session_id: sid, ...extra });

const ask = (ws: string, sid: string) => plant(ws, `.tmp/repo/orchestrator-logs/session-gate-${sid}`, "ask");

const gitIn = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  }).trim();

/** A checkout with a bare origin, `main` pushed once, and one more commit not yet pushed. */
function checkout() {
  const origin = fs.realpathSync(temp("origin-"));
  const ws = fs.realpathSync(temp("clone-"));
  const git = (...args: string[]) => gitIn(ws, ...args);
  gitIn(origin, "init", "--bare", "-b", "main");
  git("init", "-b", "main");
  git("remote", "add", "origin", origin);
  plant(ws, "a.txt", "one");
  git("add", "a.txt");
  git("commit", "-m", "one");
  git("push", "origin", "main");
  plant(ws, "a.txt", "two");
  git("commit", "-am", "two");
  return { git, land: () => git("push", "origin", "main"), origin, sha: git("rev-parse", "HEAD"), ws };
}

/** The PreToolUse of a Bash `git push origin main`. */
const push = (ws: string, sid: string, extra: Record<string, unknown> = {}) =>
  send(ws, {
    hook_event_name: "PreToolUse",
    session_id: sid,
    tool_input: { command: "git push origin main" },
    tool_name: "Bash",
    ...extra,
  });

const inPush = (command: string) => ({ tool_input: { command } });

const result = (ws: string, sha: string, outcome: string) =>
  plant(ws, `.tmp/repo/ci/${sha}.json`, JSON.stringify({ at: "t", branch: "main", failed: [], outcome }));

const line = (sha: string) =>
  `Stop: you pushed ${sha.slice(0, 7)} to main and its ci run has no result; run \`bun repo ci wait main\` in the background and fix it if it fails`;

it("blocks a turn that pushed and never waited, then passes once the run passed", () => {
  const { ws, sha, land } = checkout();
  expect(push(ws, "g1")).toBeNull();
  land();
  expect(stop(ws, "g1", { last_assistant_message: "Done." })).toStrictEqual({
    decision: "block",
    reason: line(sha),
  });
  result(ws, sha, "passed");
  expect(stop(ws, "g1", { last_assistant_message: "Done." })).toBeNull();
});

it("ignores a push that origin rejected", () => {
  const { ws } = checkout();
  push(ws, "g2");
  expect(stop(ws, "g2", { last_assistant_message: "Done." })).toBeNull();
});

it("notes a push that a subagent runs, for the parent's Stop", () => {
  const { ws, sha, land } = checkout();
  push(ws, "g3", { subagent_type: "worker" });
  land();
  expect(stop(ws, "g3", { last_assistant_message: "Done." })?.reason).toBe(line(sha));
});

it("leaves a subagent's Stop to its own check", () => {
  const { ws, land } = checkout();
  push(ws, "g4");
  land();
  expect(
    stop(ws, "g4", {
      last_assistant_message: "Done.",
      subagent_type: "scout",
    }),
  ).toBeNull();
});

it("blocks again while the stop hook is active, unlike the ask and away checks", () => {
  const { ws, sha, land } = checkout();
  push(ws, "g5");
  land();
  expect(
    stop(ws, "g5", {
      last_assistant_message: "Done.",
      stop_hook_active: true,
    })?.reason,
  ).toBe(line(sha));
});

it("blocks before the ask check and does not spend its stop-block count", () => {
  const { ws, sha, land } = checkout();
  ask(ws, "g6");
  push(ws, "g6");
  land();
  expect(stop(ws, "g6", { last_assistant_message: "Done." })?.reason).toBe(line(sha));
  expect(fs.existsSync(path.join(ws, ".tmp/repo/orchestrator-logs/stop-block-g6"))).toBe(false);
});

it("lets the stop through after six blocks, and a new prompt clears the count", () => {
  const { ws, sha, land } = checkout();
  push(ws, "g7");
  land();
  for (let i = 0; i < 6; i++) expect(stop(ws, "g7", { last_assistant_message: "Done." })?.reason).toBe(line(sha));
  expect(stop(ws, "g7", { last_assistant_message: "Done." })).toBeNull();
  send(ws, {
    hook_event_name: "UserPromptSubmit",
    prompt: "go on",
    session_id: "g7",
  });
  expect(fs.existsSync(path.join(ws, ".tmp/repo/orchestrator-logs/push-block-g7"))).toBe(false);
  expect(stop(ws, "g7", { last_assistant_message: "Done." })?.reason).toBe(line(sha));
});

it("blocks on the commit a commit-then-push command sent, not the one before it", () => {
  const { ws, git } = checkout();
  push(ws, "g8", inPush("git commit -am three && git push origin main"));
  plant(ws, "a.txt", "three");
  git("commit", "-am", "three");
  git("push", "origin", "main");
  expect(stop(ws, "g8", { last_assistant_message: "Done." })?.reason).toBe(line(git("rev-parse", "HEAD")));
});

it("blocks on the commit a push-then-commit command sent, not the one made after it", () => {
  const { ws, sha, git } = checkout();
  push(ws, "g9", inPush("git push origin main && git commit -am three"));
  git("push", "origin", "main");
  plant(ws, "a.txt", "three");
  git("commit", "-am", "three");
  expect(stop(ws, "g9", { last_assistant_message: "Done." })?.reason).toBe(line(sha));
});

it("notes nothing for a tool with no command or a payload with no session", () => {
  const { ws, land } = checkout();
  push(ws, "g10", { tool_input: undefined });
  send(ws, { hook_event_name: "PreToolUse", tool_input: { command: "git push origin main" }, tool_name: "Bash" });
  land();
  expect(stop(ws, "", { last_assistant_message: "Done." })).toBeNull();
  expect(stop(ws, "g10", { last_assistant_message: "Done." })).toBeNull();
});
