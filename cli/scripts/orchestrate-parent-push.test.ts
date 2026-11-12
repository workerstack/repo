import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { claudeHook } from "./__fixtures__/claude-hook.ts";
import { plantFile } from "./__fixtures__/plant-file.ts";
import type { HookInput } from "./hook-input.ts";

const hook = claudeHook();

function ask(ws: string, sid: string) {
  return plantFile(ws, `.tmp/repo/orchestrator-logs/session-gate-${sid}`, "ask");
}

function gitIn(cwd: string, ...args: string[]) {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
}

/** A checkout with a bare origin, `main` pushed once, and one more commit not yet pushed. */
function checkout() {
  const origin = fs.realpathSync(hook.temp("origin-"));
  const ws = fs.realpathSync(hook.temp("clone-"));

  function git(...args: string[]) {
    return gitIn(ws, ...args);
  }

  gitIn(origin, "init", "--bare", "-b", "main");
  git("init", "-b", "main");
  git("remote", "add", "origin", origin);
  plantFile(ws, "a.txt", "one");
  git("add", "a.txt");
  git("commit", "-m", "one");
  git("push", "origin", "main");
  plantFile(ws, "a.txt", "two");
  git("commit", "-am", "two");

  return { git, land: () => git("push", "origin", "main"), origin, sha: git("rev-parse", "HEAD"), ws };
}

/** The PreToolUse of a Bash `git push origin main`. */
function push(ws: string, sid: string, extra: HookInput = {}) {
  return hook.send(ws, {
    hook_event_name: "PreToolUse",
    session_id: sid,
    tool_input: { command: "git push origin main" },
    tool_name: "Bash",
    ...extra,
  });
}

function inPush(command: string) {
  return { tool_input: { command } };
}

function result(ws: string, sha: string, outcome: string) {
  return plantFile(ws, `.tmp/repo/ci/${sha}.json`, JSON.stringify({ at: "t", branch: "main", failed: [], outcome }));
}

function line(sha: string) {
  return (
    `Stop: you pushed ${sha.slice(0, 7)} to main and its ci run has no result; ` +
    "run `bun repo ci wait main` in the background and fix it if it fails"
  );
}

it("blocks a turn that pushed and never waited, then passes once the run passed", () => {
  const { ws, sha, land } = checkout();
  expect(push(ws, "g1")).toBeNull();
  land();
  expect(hook.stop(ws, "g1", { last_assistant_message: "Done." })).toStrictEqual({
    decision: "block",
    reason: line(sha),
  });
  result(ws, sha, "passed");
  expect(hook.stop(ws, "g1", { last_assistant_message: "Done." })).toBeNull();
});

it("ignores a push that origin rejected", () => {
  const { ws } = checkout();
  push(ws, "g2");
  expect(hook.stop(ws, "g2", { last_assistant_message: "Done." })).toBeNull();
});

it("notes a push that a subagent runs, for the parent's Stop", () => {
  const { ws, sha, land } = checkout();
  push(ws, "g3", { subagent_type: "worker" });
  land();
  expect(hook.stop(ws, "g3", { last_assistant_message: "Done." })?.reason).toBe(line(sha));
});

it("leaves a subagent's Stop to its own check", () => {
  const { ws, land } = checkout();
  push(ws, "g4");
  land();
  expect(
    hook.stop(ws, "g4", {
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
    hook.stop(ws, "g5", {
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
  expect(hook.stop(ws, "g6", { last_assistant_message: "Done." })?.reason).toBe(line(sha));
  expect(fs.existsSync(path.join(ws, ".tmp/repo/orchestrator-logs/stop-block-g6"))).toBe(false);
});

it("lets the stop through after six blocks, and a new prompt clears the count", () => {
  const { ws, sha, land } = checkout();
  push(ws, "g7");
  land();

  for (let i = 0; i < 6; i++) expect(hook.stop(ws, "g7", { last_assistant_message: "Done." })?.reason).toBe(line(sha));
  expect(hook.stop(ws, "g7", { last_assistant_message: "Done." })).toBeNull();
  hook.send(ws, {
    hook_event_name: "UserPromptSubmit",
    prompt: "go on",
    session_id: "g7",
  });
  expect(fs.existsSync(path.join(ws, ".tmp/repo/orchestrator-logs/push-block-g7"))).toBe(false);
  expect(hook.stop(ws, "g7", { last_assistant_message: "Done." })?.reason).toBe(line(sha));
});

it("blocks on the commit a commit-then-push command sent, not the one before it", () => {
  const { ws, git } = checkout();
  push(ws, "g8", inPush("git commit -am three && git push origin main"));
  plantFile(ws, "a.txt", "three");
  git("commit", "-am", "three");
  git("push", "origin", "main");
  expect(hook.stop(ws, "g8", { last_assistant_message: "Done." })?.reason).toBe(line(git("rev-parse", "HEAD")));
});

it("blocks on the commit a push-then-commit command sent, not the one made after it", () => {
  const { ws, sha, git } = checkout();
  push(ws, "g9", inPush("git push origin main && git commit -am three"));
  git("push", "origin", "main");
  plantFile(ws, "a.txt", "three");
  git("commit", "-am", "three");
  expect(hook.stop(ws, "g9", { last_assistant_message: "Done." })?.reason).toBe(line(sha));
});

it("notes nothing for a tool with no command or a payload with no session", () => {
  const { ws, land } = checkout();
  push(ws, "g10", { tool_input: undefined });
  hook.send(ws, { hook_event_name: "PreToolUse", tool_input: { command: "git push origin main" }, tool_name: "Bash" });
  land();
  expect(hook.stop(ws, "", { last_assistant_message: "Done." })).toBeNull();
  expect(hook.stop(ws, "g10", { last_assistant_message: "Done." })).toBeNull();
});
