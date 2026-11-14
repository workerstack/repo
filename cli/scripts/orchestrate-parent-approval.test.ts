import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { claudeHook } from "./__fixtures__/claude-hook.ts";
import { closing, plan as planItem, roadmap } from "./__fixtures__/orchestrate-kit.ts";
import { VALID_PLAN } from "./__fixtures__/persist-bodies.ts";
import { plantFile } from "./__fixtures__/plant-file.ts";
import type { HookInput } from "./hook-input.ts";

const hook = claudeHook();

/** The context lines a UserPromptSubmit reply adds; empty when the hook stays silent. */
function say(ws: string, sid: string, extra: HookInput): string[] {
  const out = hook.send(ws, { hook_event_name: "UserPromptSubmit", session_id: sid, ...extra });

  return out === null ? [] : out.hookSpecificOutput.additionalContext.split("\n");
}

function stop(ws: string, sid: string, msg: string) {
  return hook.stop(ws, sid, { last_assistant_message: msg });
}

/** A saved plan or roadmap as the frontmatter reader sees it; `lines` are the frontmatter lines after the serial. */
function item(serial: number, ...lines: string[]) {
  return `---\nserial: ${serial}\n${lines.join("\n")}\n---\n\n# body\n`;
}

const SETTLED = ["status: ready", "reviews: 1", "strategy: free"];

function transcript(ws: string, text: string): string {
  const rec = JSON.stringify({ message: { content: [{ text, type: "text" }], role: "assistant" }, type: "assistant" });

  return plantFile(ws, "transcript.jsonl", `${rec}\n`);
}

describe("a prompt", () => {
  it("is read from whichever field the host used", () => {
    const ws = hook.temp();

    for (const field of ["userPrompt", "user_prompt", "content"]) {
      const sid = `f-${field}`;
      expect(say(ws, sid, { [field]: "/ask" })[0], field).toMatch(/^approval=ask\b/);
    }

    expect(say(ws, "f-none", {})[0]).toMatch(/^approval=ask\b/);
  });

  it("is ignored when it is a host banner", () => {
    const ws = hook.temp();
    expect(say(ws, "b1", { prompt: "Blocked by stop hook: ask" })).toStrictEqual([]);
    expect(say(ws, "b1", { prompt: "<task-notification>done</task-notification>" })).toStrictEqual([]);
  });

  it("ignores a session gate in the old .tmp dir", () => {
    const ws = hook.temp();
    plantFile(ws, ".tmp/orchestrator-logs/session-gate-lg", "away");
    expect(say(ws, "lg", { prompt: "go on" })[0]).toMatch(/^approval=ask\b/);
  });
});

describe("an approval block read against the saved items", () => {
  const planOne = closing(planItem(1));
  const blocked = "plan 1 has reviews: 0; run /review-plan 1 in a fresh agent first";

  it("blocks a plan that has no review, reading a review record that is not a map as no record", () => {
    const ws = hook.temp();
    plantFile(ws, ".repo/plans/1-x.md", item(1, "status: ready", "reviews: 0", "strategy: free"));
    expect(stop(ws, "k0", planOne)?.reason).toBe(blocked);
    const record = ".repo/tmp/sessions/k1/reviews-open.json";
    plantFile(ws, record, "[1]");
    expect(stop(ws, "k1", planOne)?.reason).toBe(blocked);
    plantFile(ws, record, '{"plan 1":"0"}');
    expect(stop(ws, "k1", planOne)?.reason).toBe(blocked);
  });

  it("reads a plan with no reviews line as unreviewed", () => {
    const ws = hook.temp();
    plantFile(ws, ".repo/plans/1-x.md", item(1, "status: ready", "strategy: free"));
    expect(stop(ws, "k4", planOne)?.reason).toBe(blocked);
  });

  it("holds a plan whose review record is open", () => {
    const ws = hook.temp();
    plantFile(ws, ".repo/plans/1-x.md", item(1, "status: ready", "reviews: 0", "strategy: free"));
    plantFile(ws, ".repo/tmp/sessions/k2/reviews-open.json", '{"plan 1":0,"plan 2":"x"}');
    expect(stop(ws, "k2", planOne)?.reason).toMatch(/^plan 1's review has not settled/);
  });

  it("names no file for a serial the frontmatter does not carry", () => {
    const ws = hook.temp();
    plantFile(ws, ".repo/plans/5-x.md", item(6, "status: ready", "reviews: 0", "strategy: free"));
    expect(stop(ws, "k3", closing(planItem(5)))).toBeNull();
  });
});

/** A turn that saved one approvable plan, one approvable roadmap and five items that cannot be approved. */
function stamped(ws: string, sid: string): void {
  say(ws, sid, { prompt: "plan it" });

  const lines = [
    path.join(ws, "other.md"),
    path.join(ws, ".repo/plans/9-missing.md"),
    path.join(ws, ".repo/plans/4-bare.md"),
    path.join(ws, ".repo/plans/2-nostatus.md"),
    path.join(ws, ".repo/plans/3-nostrategy.md"),
    path.join(ws, ".repo/plans/7-ok.md"),
    path.join(ws, ".repo/roadmaps/3-r.md"),
  ];

  plantFile(ws, "other.md", "not an item");
  plantFile(ws, ".repo/plans/4-bare.md", "no frontmatter at all");
  plantFile(ws, ".repo/plans/2-nostatus.md", item(2, "reviews: 1", "strategy: free"));
  plantFile(ws, ".repo/plans/3-nostrategy.md", item(3, "a line with no key", "status: ready", "reviews: 1"));
  plantFile(ws, ".repo/plans/7-ok.md", item(7, ...SETTLED));
  plantFile(ws, ".repo/roadmaps/3-r.md", item(3, "status: draft", "reviews: 1", "strategy: free"));
  plantFile(ws, `.repo/tmp/sessions/${sid}/approvals.txt`, `${lines.join("\n")}\n`);
}

describe("a turn that saved reviewed items", () => {
  it("asks for an approval block over only the items that can be approved", () => {
    const ws = hook.temp();
    stamped(ws, "p1");
    expect(stop(ws, "p1", "Saved.")?.reason).toBe(`end with this block:\n${closing(planItem(7), roadmap(3))}`);
  });
});

describe("a reply of i", () => {
  it("approves nothing without a session", () => {
    const ws = hook.temp();
    const tp = transcript(ws, closing(planItem(1)));
    expect(say(ws, "", { prompt: "y", transcript_path: tp })).toStrictEqual(["approval=ask"]);
  });

  it("refuses a strategy change when the plan has no frontmatter block to carry it", () => {
    const ws = hook.temp();
    const file = plantFile(ws, ".repo/plans/2-x.md", `---\nserial: 2\n${SETTLED.join("\n")}\n---`);
    plantFile(ws, ".repo/tmp/sessions/y1/approvals.txt", `${file}\n`);
    const tp = transcript(ws, closing(planItem(2)));
    expect(say(ws, "y1", { prompt: "y spawn-fast", transcript_path: tp })).toContain(
      "i did not approve plan 2: strategy spawn-fast could not be written (no frontmatter)",
    );
  });
});

/** A new plan saved through the hook the way the host lands it, with its review round done. */
function reviewedPlan(ws: string, sid: string): string {
  const out = hook.send(ws, {
    hook_event_name: "PreToolUse",
    session_id: sid,
    tool_input: { content: VALID_PLAN, file_path: ".repo/plans/new.md" },
    tool_name: "Write",
  });

  const landed = out?.hookSpecificOutput.updatedInput;
  const file = landed?.file_path ?? "";
  fs.writeFileSync(file, (landed?.content ?? "").replace("reviews: 0", "reviews: 1"));

  return file;
}

describe("a reply of i to a plan that cannot be rewritten", () => {
  it("refuses the strategy change and leaves the plan as it was", () => {
    const ws = hook.temp();
    const plan = reviewedPlan(ws, "y2");
    fs.chmodSync(plan, 0o444);
    const tp = transcript(ws, closing(planItem(1)));
    const lines = say(ws, "y2", { prompt: "y spawn-fast", transcript_path: tp });
    expect(lines.find((l) => l.startsWith("i did not approve"))).toContain("plan 1: strategy spawn-fast could not be");
    expect(fs.readFileSync(plan, "utf8")).toContain("strategy: free");
  });
});

describe("a reply of h", () => {
  // A newline cannot be part of a file name on Windows.
  it.skipIf(process.platform === "win32")("refuses when the session id would break the handoff", () => {
    const ws = hook.temp();
    const sid = "s1\n## Extra";
    const file = plantFile(ws, ".repo/plans/1-x.md", item(1, ...SETTLED));
    plantFile(ws, `.repo/tmp/sessions/${sid}/approvals.txt`, `${file}\n`);
    const tp = transcript(ws, closing(planItem(1)));
    const lines = say(ws, sid, { prompt: "h", transcript_path: tp });
    expect(lines.some((l) => l.startsWith("h did not hand off plan 1: the handoff could not be written"))).toBe(true);
    expect(fs.readdirSync(path.join(ws, ".repo/handoffs"))).toStrictEqual([]);
  });
});
