import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { hookSession, type HookSession } from "./__fixtures__/hook-session.ts";
import { closing, must, orchestrateKit, replyOf } from "./__fixtures__/orchestrate-kit.ts";
import { DRAFT_ROADMAP, VALID_PLAN } from "./__fixtures__/persist-bodies.ts";
import { closingLine, parseClosingLine } from "./closing-line.ts";
import { isSliceOf } from "./orchestrate-reviews.ts";
import { ASK_STOP_REASON } from "./orchestrate.constants.ts";

const kit = orchestrateKit();
/** Session `sid` in `ws`, sent in Claude's shape with the project dir set. */
function claude(ws: string, sid: string): HookSession {
  return hookSession(kit, { env: { CLAUDE_PROJECT_DIR: ws }, shape: "claude", sid, ws });
}
function approvals(ws: string, sid: string) {
  return fs
    .readFileSync(path.join(ws, ".tmp/repo/sessions", sid, "approvals.txt"), "utf8")
    .trim()
    .split("\n");
}
function dflt(...items: string[]) {
  return items.map((i) => `${i} (strategy: default)`).join(", then ");
}

it("records the saved path of each plan and roadmap save, Claude and Grok shapes", () => {
  const ws = kit.temp();
  const s = claude(ws, "s1");
  s.say("plan it");
  const plan = s.reviewed("plans", VALID_PLAN);
  expect(path.basename(plan)).toMatch(/^1-add-tmp-ignore-/);
  const input = { content: DRAFT_ROADMAP, path: ".tmp/repo/roadmaps/y.md" };
  const grok = kit.grok({ sid: "s1", ws }, "PreToolUse", { toolInput: input, toolName: "write" });
  const roadmap = must(replyOf(grok)).hookSpecificOutput.updatedInput.path;
  expect(approvals(ws, "s1")).toStrictEqual([plan, roadmap]);
});

/** A turn: a prompt, then one more reviewed plan saved in it. */
function turn(s: HookSession, text: string): void {
  s.say(text);
  s.reviewed("plans", VALID_PLAN);
}

it("blocks once per turn until the reply ends with the closing line naming every pending item", () => {
  const ws = kit.temp();
  const s = claude(ws, "s2");
  turn(s, "plan it");
  const ask = s.stop("Plan 1 is saved.\nShall I start?");
  expect(ask).toStrictEqual({
    decision: "block",
    reason: `end with: ${closingLine([{ kind: "plan", serial: 1, strategy: "default" }])}`,
  });
  expect(ask?.reason).toBe(`end with: ${closing(dflt("plan 1"))}`);
  const grokAgain = kit.grok({ sid: "s2", ws }, "Stop", { lastAssistantMessage: "Shall I start?", reason: "end_turn" });
  expect(grokAgain.stdout).toBe("");
  turn(s, "more");
  expect(s.stop(`Plan 2 is saved.\n\n**${closing(dflt("plan 1", "plan 2"))}**`)).toBeNull();
  turn(s, "and a roadmap");
  s.reviewed("roadmaps", DRAFT_ROADMAP);
  expect(s.stop("Saved.")?.reason).toBe(`end with: ${closing(dflt("plan 1", "plan 2", "plan 3", "roadmap 1"))}`);
  turn(s, "again");
  expect(s.stop('Reply "y" to run plan 1.')?.decision).toBe("block");
  turn(s, "again");
  expect(s.stop(closing(dflt("plan 5", "plan 9")))?.decision).toBe("block");
});

it("does not take the old closing line for an ask, in any markdown wrapping", () => {
  const s = claude(kit.temp(), "old");
  turn(s, "plan it");
  for (const old of ['Reply "y" to run plan 1.', '**Reply "y" to run plan 1.**', '`Reply "y" to run plan 1.`']) {
    expect(parseClosingLine(old)).toBeNull();
    expect(s.stop(`Saved.\n\n${old}`)?.decision).toBe("block");
    turn(s, "again");
  }
});

it("blocks when the line shows a strategy the file does not hold, and names the line the files render", () => {
  const s = claude(kit.temp(), "mis");
  const fast = VALID_PLAN.replace("strategy: default", "strategy: review-fast");
  s.say("plan it");
  s.reviewed("plans", fast);
  const line = closing(dflt("plan 1"));
  expect(parseClosingLine(line)).not.toBeNull();
  const others = 'or "y default" / "y review-deep", or "h" / "h fast" / "h deep" for a fresh session.';
  expect(s.stop(`Saved.\n\n${line}`)).toStrictEqual({
    decision: "block",
    reason: `end with: Reply "y" to run plan 1 (strategy: review-fast), ${others}`,
  });
  s.say("again");
  s.reviewed("plans", fast);
  const both = `Reply "y" to run plan 1 (strategy: review-fast), then plan 2 (strategy: review-fast), ${others}`;
  expect(s.stop(both)).toBeNull();
});

it("does not block on earlier turns or roadmap child plans", () => {
  const s3 = claude(kit.temp(), "s3");
  s3.say("plan it");
  const plan = s3.reviewed("plans", VALID_PLAN);
  expect(plan).toBeTruthy();
  // File times tick coarsely, so a save in the same tick as the next prompt would read as saved this turn.
  const earlier = new Date(Date.now() - 60_000);
  fs.utimesSync(plan, earlier, earlier);
  s3.say("something else");
  expect(s3.stop("Done.")).toBeNull();
  const child = kit.temp();
  const s4 = claude(child, "s4");
  s4.say("run the roadmap");
  const childPlan = s4.reviewed("plans", VALID_PLAN);
  fs.mkdirSync(path.join(child, ".tmp/repo/roadmaps"), { recursive: true });
  const fm = "serial: 1\nname: auth-program\nstatus: in-progress\nreviews: 1\nstrategy: default";
  fs.writeFileSync(
    path.join(child, ".tmp/repo/roadmaps/1-auth-program-20261103T000000Z.md"),
    `---\n${fm}\n---\n\n## Order\n1 [ ] Title: auth types\n      Location: ${childPlan}\n`,
  );
  expect(s4.stop("Wrote plan 1.")).toBeNull();
});

it("matches a slice's Location to its plan per platform", () => {
  const win = "1 [ ] Title: t\n      Location: C:\\Users\\me\\repo\\.tmp\\repo\\plans\\1-x.md\n";
  expect(isSliceOf("c:/Users/me/repo/.tmp/repo/plans/1-x.md", win, path.win32)).toBe(true);
  const posix = "      Location: /r/.tmp/repo/plans/1-x.md\n";
  expect(isSliceOf("/r/.tmp/repo/plans/2-x.md", posix, path.posix)).toBe(false);
});

it("does not block on missing turn stamps or a missing session", () => {
  const noTurn = claude(kit.temp(), "s5");
  noTurn.reviewed("plans", VALID_PLAN);
  expect(noTurn.stop("Done.")).toBeNull();
  const ws = kit.temp();
  const noSid = claude(ws, "");
  noSid.say("plan it");
  noSid.reviewed("plans", VALID_PLAN);
  expect(fs.existsSync(path.join(ws, ".tmp/repo/sessions"))).toBe(false);
  expect(noSid.stop("Done.")).toBeNull();
});

it("under /ask the closing line counts as the step ask", () => {
  const s = claude(kit.temp(), "s7");
  s.say("/ask");
  expect(s.stop(`Saved.\n\n${closing(dflt("plan 3"))}`)).toBeNull();
  expect(s.stop('Saved.\n\nReply "y" to run plan 3.')?.reason).toBe(ASK_STOP_REASON);
  expect(s.stop("Saved plan 3.")?.reason).toBe(ASK_STOP_REASON);
});
