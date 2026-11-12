import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import {
  agySh,
  ask,
  askedFile,
  claudeSh,
  claudeWrite,
  codexPatch,
  cursorSh,
  deny,
  reasonOf,
  SID,
  STASH_REASON,
} from "./__fixtures__/checkout-calls.ts";
import { useTmp } from "./__fixtures__/gate-workspace.ts";
import { agyCall, denyReason, notDenied } from "./__fixtures__/hook-payload.ts";
import { reviewReason, startReview } from "./__fixtures__/review-plan.ts";
import { processFatTools, processHookPayload } from "./gate-fat-tools.ts";

const tmp = useTmp();

function asked(words: string[]) {
  return JSON.stringify({ words });
}

it("denies a git command that commits or destroys work in the main checkout, in every harness's shell", () => {
  const r = tmp.committed("gate-main-");
  const a = path.join(r, ".worktrees/a");

  const commit =
    `the main checkout is shared: commit inside ${path.join(r, ".worktrees", "<name>")}, ` +
    "then run bun repo worktree finish <name>";

  expect(processFatTools(claudeSh(r, "git commit -m x"))).toStrictEqual(deny(commit));
  expect(processFatTools(claudeSh(r, "git add -A && git commit -m x", { agent_type: "scout" }))).toStrictEqual(
    deny(commit),
  );
  expect(processFatTools(claudeSh(r, "rtk git commit -m x"))).toStrictEqual(deny(commit));
  expect(processFatTools(cursorSh(r, "git stash"))).toStrictEqual(deny(STASH_REASON));
  expect(processHookPayload(cursorSh(r, "git stash"))).toMatchObject({
    agent_message: STASH_REASON,
    permission: "deny",
  });
  expect(processFatTools(agySh(r, "git stash"))).toStrictEqual(deny(STASH_REASON));
  expect(processFatTools(claudeSh(r, "git -C .worktrees/a stash"))).toBeNull();
  expect(processFatTools(claudeSh(a, "git stash && git reset --hard && git commit --amend"))).toBeNull();
  expect(processFatTools(agyCall(r, "run_command", { CommandLine: "git stash", Cwd: a }))).toBeNull();
  expect(notDenied(processFatTools(claudeSh(r, "git status && git log --oneline")))).toBe(true);
  const heredocNote = "cat > .tmp/n.md <<'EOF'\ngit stash\ngit commit -m x\nEOF";
  expect(notDenied(processFatTools(claudeSh(r, heredocNote)))).toBe(true);
});

it("denies the shared-ref cases from inside a worktree", () => {
  const r = tmp.committed("gate-main-");
  const a = path.join(r, ".worktrees/a");
  const force = "a force push rewrites shared history: run it only when the user's message asks for a force push";
  expect(processFatTools(claudeSh(a, "git push --force"))).toStrictEqual(deny(force));
  expect(processFatTools(claudeSh(a, "git branch -D wt/other"))).toBeNull();
  const main = processFatTools(claudeSh(a, "git branch -D main"));
  expect(main?.type).toBe("deny");
  expect(denyReason(main)).toContain("main is the shared default branch");
  expect(processFatTools(claudeSh(a, "git branch -D scratch"))).toBeNull();
});

it("lets a subcommand run once the session's git-asked.json holds it, and nothing else", () => {
  const r = tmp.committed("gate-main-");
  expect(processFatTools(claudeSh(r, "git stash"))).toMatchObject({ type: "deny" });
  expect(fs.existsSync(askedFile(r))).toBe(false);
  ask(r, asked(["stash"]));

  for (const send of [
    (c: string) => claudeSh(r, c),
    (c: string) => cursorSh(r, c),
    (c: string) => claudeSh(r, c, { agent_type: "scout" }),
  ]) {
    expect(processFatTools(send("git stash")), "stash asked").toBeNull();
    expect(processFatTools(send("git commit -m x")), "commit still denied").toMatchObject({ type: "deny" });
  }

  ask(r, asked(["commit", "force"]));
  expect(processFatTools(claudeSh(r, "git commit -m x"))).toBeNull();
  expect(processFatTools(claudeSh(r, "git push --force"))).toBeNull();
  expect(processFatTools(claudeSh(r, "git stash"))).toMatchObject({ type: "deny" });
  // another session's grant does not carry over
  expect(processFatTools(claudeSh(r, "git commit -m x", { session_id: "other" }))).toMatchObject({ type: "deny" });
  // a grant never frees a product write
  expect(processFatTools(claudeWrite(r, path.join(r, "src/x.ts")))).toStrictEqual(deny(reasonOf(r)));
  expect(fs.readFileSync(askedFile(r), "utf8")).toBe(asked(["commit", "force"]));
});

it("treats a missing session id, a missing file and a bad file as no grant", () => {
  const r = tmp.committed("gate-main-");
  const noSid = { cwd: r, tool_input: { command: "git stash" }, tool_name: "Bash" };
  expect(processFatTools(noSid)).toMatchObject({ type: "deny" });

  for (const bad of ["{", "null", "[]", '{"words":"stash"}', '{"words":[1,null]}', ""]) {
    ask(r, bad);
    expect(processFatTools(claudeSh(r, "git stash")), bad).toMatchObject({ type: "deny" });
  }

  fs.rmSync(askedFile(r));
  expect(processFatTools(claudeSh(r, "git stash"))).toMatchObject({ type: "deny" });
});

it("sits ahead of the review guard: the main checkout reason wins there, a worktree hits the review reason", () => {
  const r = tmp.committed("gate-main-");
  startReview(r, { sid: SID });
  const review = deny(reviewReason("review-fast"));
  const inWorktree = path.join(r, ".worktrees/a/src/x.ts");
  expect(processFatTools(claudeWrite(r, path.join(r, "src/x.ts")))).toStrictEqual(deny(reasonOf(r)));
  expect(processFatTools(claudeWrite(r, inWorktree))).toStrictEqual(review);
  expect(processFatTools(codexPatch(r, inWorktree))).toStrictEqual(review);

  for (const child of ["implementer-fast", "scout"])
    expect(processFatTools(claudeWrite(r, inWorktree, { agent_type: child })), child).toBeNull();

  expect(notDenied(processFatTools(claudeWrite(r, path.join(r, ".tmp/repo/n.md"))))).toBe(true);
});
