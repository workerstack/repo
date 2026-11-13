import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { hookSession, type HookSession } from "./__fixtures__/hook-session.ts";
import { closing, must, orchestrateKit, plan, replyOf, roadmap } from "./__fixtures__/orchestrate-kit.ts";
import { DRAFT_ROADMAP, VALID_PLAN } from "./__fixtures__/persist-bodies.ts";
import { isSliceOf } from "./orchestrate-reviews.ts";
import { ASK_STOP_REASON } from "./orchestrate.constants.ts";

const kit = orchestrateKit();

/** Session `sid` in `ws`, sent in Claude's shape with the project dir set. */
function claude(ws: string, sid: string): HookSession {
  return hookSession(kit, { casing: "claude", env: { CLAUDE_PROJECT_DIR: ws }, sid, ws });
}

function approvals(ws: string, sid: string) {
  return fs
    .readFileSync(path.join(ws, ".repo/tmp/sessions", sid, "approvals.txt"), "utf8")
    .trim()
    .split("\n");
}

it("records the saved path of each plan and roadmap save, Claude and Grok shapes", () => {
  const ws = kit.temp();
  const s = claude(ws, "s1");
  s.say("plan it");
  const planPath = s.reviewed("plans", VALID_PLAN);
  expect(path.basename(planPath)).toMatch(/^1-add-tmp-ignore-/);
  const input = { content: DRAFT_ROADMAP, path: ".repo/roadmaps/y.md" };
  const grok = kit.grok({ sid: "s1", ws }, "PreToolUse", { toolInput: input, toolName: "write" });
  const roadmapPath = must(replyOf(grok)).hookSpecificOutput.updatedInput.path;
  expect(approvals(ws, "s1")).toStrictEqual([planPath, roadmapPath]);
});

/** A turn: a prompt, then one more reviewed plan saved in it. */
function turn(s: HookSession, text: string): void {
  s.say(text);
  s.reviewed("plans", VALID_PLAN);
}

const OLD_LINE =
  'Reply "y" to run plan 1 (strategy: default), or "y spawn-fast" / "y spawn-deep", ' +
  'or "h" / "h fast" / "h deep" for a fresh session.';

it("blocks once per turn until the reply ends with the block naming every pending item", () => {
  const ws = kit.temp();
  const s = claude(ws, "s2");
  turn(s, "plan it");
  const ask = s.stop("Plan 1 is saved.\nShall I start?");
  expect(ask).toStrictEqual({ decision: "block", reason: `end with this block:\n${closing(plan(1))}` });
  const grokAgain = kit.grok({ sid: "s2", ws }, "Stop", { lastAssistantMessage: "Shall I start?", reason: "end_turn" });
  expect(grokAgain.stdout).toBe("");
  turn(s, "more");
  expect(s.stop(`Plan 2 is saved.\n\n${closing(plan(1), plan(2))}`)).toBeNull();
  turn(s, "and a roadmap");
  s.reviewed("roadmaps", DRAFT_ROADMAP);
  expect(s.stop("Saved.")?.reason).toBe(`end with this block:\n${closing(plan(1), plan(2), plan(3), roadmap(1))}`);
  turn(s, "again");
  expect(s.stop(`Saved.\n\n${closing(plan(1))}`)?.decision).toBe("block");
  turn(s, "again");
  expect(s.stop(closing(plan(5), plan(9)))?.decision).toBe("block");
});

it("does not take the old Reply line for an ask, in any markdown wrapping", () => {
  const s = claude(kit.temp(), "old");
  turn(s, "plan it");

  const saved = [plan(1)];

  for (const old of [OLD_LINE, `**${OLD_LINE}**`, `\`${OLD_LINE}\``, 'Reply "y" to run plan 1.']) {
    const out = s.stop(`Saved.\n\n${old}`);
    expect(out?.decision).toBe("block");
    expect(out?.reason).toBe(`end with this block:\n${closing(...saved)}`);
    turn(s, "again");
    saved.push(plan(saved.length + 1));
  }
});

it("blocks a block that is followed by more text", () => {
  const s = claude(kit.temp(), "tail");
  turn(s, "plan it");
  expect(s.stop(`Saved.\n\n${closing(plan(1))}\n\nShall I?`)?.decision).toBe("block");
});

it("blocks when the block shows a strategy the file does not hold, and names the block the files render", () => {
  const s = claude(kit.temp(), "mis");
  const fast = VALID_PLAN.replace("strategy: default", "strategy: spawn-fast");
  s.say("plan it");
  s.reviewed("plans", fast);
  expect(s.stop(`Saved.\n\n${closing(plan(1))}`)).toStrictEqual({
    decision: "block",
    reason: `end with this block:\n${closing(plan(1, "spawn-fast"))}`,
  });
  s.say("again");
  s.reviewed("plans", fast);
  expect(s.stop(closing(plan(1, "spawn-fast"), plan(2, "spawn-fast")))).toBeNull();
});

it("does not block on earlier turns or roadmap child plans", () => {
  const s3 = claude(kit.temp(), "s3");
  s3.say("plan it");
  const planPath = s3.reviewed("plans", VALID_PLAN);
  expect(planPath).toBeTruthy();
  // File times tick coarsely, so a save in the same tick as the next prompt would read as saved this turn.
  const earlier = new Date(Date.now() - 60_000);
  fs.utimesSync(planPath, earlier, earlier);
  s3.say("something else");
  expect(s3.stop("Done.")).toBeNull();
  const child = kit.temp();
  const s4 = claude(child, "s4");
  s4.say("run the roadmap");
  const childPlan = s4.reviewed("plans", VALID_PLAN);
  fs.mkdirSync(path.join(child, ".repo/roadmaps"), { recursive: true });
  const fm = "serial: 1\nname: auth-program\nstatus: in-progress\nreviews: 1\nstrategy: default";
  fs.writeFileSync(
    path.join(child, ".repo/roadmaps/1-auth-program-20261103T000000Z.md"),
    `---\n${fm}\n---\n\n## Order\n1 [ ] Title: auth types\n      Location: ${childPlan}\n`,
  );
  expect(s4.stop("Wrote plan 1.")).toBeNull();
});

it("matches a slice's Location to its plan per platform", () => {
  const win = "1 [ ] Title: t\n      Location: C:\\Users\\me\\repo\\.repo\\plans\\1-x.md\n";
  expect(isSliceOf("c:/Users/me/repo/.repo/plans/1-x.md", win, path.win32)).toBe(true);
  const posix = "      Location: /r/.repo/plans/1-x.md\n";
  expect(isSliceOf("/r/.repo/plans/2-x.md", posix, path.posix)).toBe(false);
});

it("does not block on missing turn stamps or a missing session", () => {
  const noTurn = claude(kit.temp(), "s5");
  noTurn.reviewed("plans", VALID_PLAN);
  expect(noTurn.stop("Done.")).toBeNull();
  const ws = kit.temp();
  const noSid = claude(ws, "");
  noSid.say("plan it");
  noSid.reviewed("plans", VALID_PLAN);
  expect(fs.existsSync(path.join(ws, ".repo/tmp/sessions"))).toBe(false);
  expect(noSid.stop("Done.")).toBeNull();
});

it("under /ask the approval block counts as the step ask", () => {
  const s = claude(kit.temp(), "s7");
  s.say("/ask");
  expect(s.stop(`Saved.\n\n${closing(plan(3))}`)).toBeNull();
  expect(s.stop(`Saved.\n\n${OLD_LINE}`)?.reason).toBe(ASK_STOP_REASON);
  expect(s.stop("Saved plan 3.")?.reason).toBe(ASK_STOP_REASON);
});
