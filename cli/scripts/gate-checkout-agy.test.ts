import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { aliasOf } from "../../dev/test-paths";
import {
  agyEdit,
  agySh,
  agyWrite,
  ask,
  claudeSh,
  deny,
  reasonOf,
  SID,
  STASH_REASON,
} from "./fixtures/checkout-calls.ts";
import { useTmp } from "./fixtures/gate-workspace.ts";
import { notDenied } from "./fixtures/hook-payload.ts";
import { processFatTools, processHookPayload } from "./gate-fat-tools.ts";

const tmp = useTmp();

it(
  "Antigravity: denies a write_file and an edit_file in the main checkout in agy's deny shape, " +
    "and passes them in a worktree",
  () => {
    const r = tmp.committed("gate-main-");
    for (const call of [agyWrite(r, path.join(r, "src/x.ts")), agyEdit(r, path.join(r, "src/x.ts"))])
      expect(processHookPayload(call)).toStrictEqual({ decision: "deny", reason: reasonOf(r) });

    for (const call of [
      agyWrite(r, path.join(r, ".worktrees/a/src/x.ts")),
      agyEdit(r, path.join(r, ".worktrees/a/src/x.ts")),
    ])
      expect(processHookPayload(call)).toBeNull();

    expect(fs.existsSync(path.join(r, "src"))).toBe(false);
  },
);

it("Antigravity: denies a Path typed through an alias of the root", () => {
  const r = tmp.committed("gate-main-");
  const alias = aliasOf(r);
  expect(processHookPayload(agyWrite(r, path.join(alias, "src/x.ts")))).toStrictEqual({
    decision: "deny",
    reason: reasonOf(r),
  });
  expect(processHookPayload(agyWrite(alias, path.join(alias, ".worktrees/a/src/x.ts")))).toBeNull();
});

it("Antigravity: redirects a root-level scratch write_file under .tmp/repo, overwriting Path only", () => {
  const r = tmp.committed("gate-main-");
  expect(processHookPayload(agyWrite(r, path.join(r, "notes.md")))).toStrictEqual({
    decision: "allow",
    overwrite: { Path: path.join(r, ".tmp/repo/notes.md") },
  });
  expect(fs.existsSync(path.join(r, "notes.md"))).toBe(false);
});

it("Antigravity: grants a git subcommand from the prompt text in lastUserInput, and nothing else", () => {
  const r = tmp.committed("gate-main-");
  function sh(command: string, extra: Record<string, string>) {
    return processFatTools(agySh(r, command, extra));
  }
  expect(processHookPayload(agySh(r, "git stash"))).toStrictEqual({ decision: "deny", reason: STASH_REASON });
  expect(notDenied(sh("git stash", { lastUserInput: "run git stash in the main checkout" }))).toBe(true);
  expect(sh("git clean -fd", { lastUserInput: "clean up the code" })).toMatchObject({ type: "deny" });
  expect(notDenied(sh("git clean -fd", { lastUserInput: "please git clean the repo" }))).toBe(true);
  // A subagent's calls carry an empty lastUserInput, so a child gets no grant.
  expect(sh("git stash", { conversationId: "child", lastUserInput: "" })).toStrictEqual(deny(STASH_REASON));
});

it("Antigravity: keeps the other harnesses' grant on the session's git-asked.json, not on lastUserInput", () => {
  const r = tmp.committed("gate-main-");
  const run = processFatTools(claudeSh(r, "git stash", { lastUserInput: "run git stash" }));
  expect(run).toMatchObject({ type: "deny" });
  ask(r, JSON.stringify({ words: ["stash"] }));
  expect(processFatTools(claudeSh(r, "git stash"))).toBeNull();
  expect(processFatTools(agySh(r, "git stash", { conversationId: SID }))).toMatchObject({ type: "deny" });
});
