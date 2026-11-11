import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { VALID_PLAN } from "./fixtures/persist-bodies.ts";
import { runHook } from "./fixtures/run-hook.ts";
import { main } from "./orchestrate-parent.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { force: true, recursive: true });
});

function temp(prefix = "approval-"): string {
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
  hookSpecificOutput: { additionalContext: string; updatedInput: { file_path: string; content: string } };
  decision?: string;
  reason?: string;
}

/** Runs the hook for one event as Claude Code sends it; the board writes to a temp home. */
function send(ws: string, payload: Record<string, unknown>): Reply | null {
  const run = runHook(main, { cwd: ws, ...payload }, { CLAUDE_PROJECT_DIR: ws, REPO_BOARD_HOME: temp("board-") });
  expect(run.status).toBe(0);
  return run.stdout ? (JSON.parse(run.stdout) /* the hook prints the shape Reply names */ as Reply) : null;
}

/** The context lines a UserPromptSubmit reply adds; empty when the hook stays silent. */
function say(ws: string, sid: string, extra: Record<string, unknown>): string[] {
  const out = send(ws, { hook_event_name: "UserPromptSubmit", session_id: sid, ...extra });
  return out ? out.hookSpecificOutput.additionalContext.split("\n") : [];
}

const stop = (ws: string, sid: string, msg: string) =>
  send(ws, { hook_event_name: "Stop", last_assistant_message: msg, session_id: sid });

/** A saved plan or roadmap as the frontmatter reader sees it; `lines` are the frontmatter lines after the serial. */
const item = (serial: number, ...lines: string[]) => `---\nserial: ${serial}\n${lines.join("\n")}\n---\n\n# body\n`;
const SETTLED = ["status: ready", "reviews: 1", "strategy: default"];

const closing = (what: string) =>
  `Reply "y" to run ${what}, or "y review-fast" / "y review-deep", or "h" / "h fast" / "h deep" for a fresh session.`;

function transcript(ws: string, text: string): string {
  const rec = JSON.stringify({ message: { content: [{ text, type: "text" }], role: "assistant" }, type: "assistant" });
  return plant(ws, "transcript.jsonl", `${rec}\n`);
}

describe("a prompt", () => {
  it("is read from whichever field the host used", () => {
    const ws = temp();
    for (const field of ["userPrompt", "user_prompt", "content"]) {
      const sid = `f-${field}`;
      expect(say(ws, sid, { [field]: "/ask" })[0], field).toMatch(/^sessionGate=ask\b/);
    }
    expect(say(ws, "f-none", {})[0]).toMatch(/^sessionGate=auto\b/);
  });

  it("is ignored when it is a host banner", () => {
    const ws = temp();
    expect(say(ws, "b1", { prompt: "Blocked by stop hook: ask" })).toStrictEqual([]);
    expect(say(ws, "b1", { prompt: "<task-notification>done</task-notification>" })).toStrictEqual([]);
  });

  it("keeps a session gate left by the previous release", () => {
    const ws = temp();
    plant(ws, ".tmp/orchestrator-logs/session-gate-lg", "ask");
    expect(say(ws, "lg", { prompt: "go on" })[0]).toMatch(/^sessionGate=ask\b/);
  });
});

describe("a closing line read against the saved items", () => {
  const ONE = closing("plan 1 (strategy: default)");
  const blocked = "plan 1 has reviews: 0; run /review-plan 1 in a fresh agent first";

  it("blocks a plan that has no review, reading a review record that is not a map as no record", () => {
    const ws = temp();
    plant(ws, ".tmp/repo/plans/1-x.md", item(1, "status: ready", "reviews: 0", "strategy: default"));
    expect(stop(ws, "k0", ONE)?.reason).toBe(blocked);
    const record = ".tmp/repo/sessions/k1/reviews-open.json";
    plant(ws, record, "[1]");
    expect(stop(ws, "k1", ONE)?.reason).toBe(blocked);
    plant(ws, record, '{"plan 1":"0"}');
    expect(stop(ws, "k1", ONE)?.reason).toBe(blocked);
  });

  it("holds a plan whose review record is open", () => {
    const ws = temp();
    plant(ws, ".tmp/repo/plans/1-x.md", item(1, "status: ready", "reviews: 0", "strategy: default"));
    plant(ws, ".tmp/repo/sessions/k2/reviews-open.json", '{"plan 1":0,"plan 2":"x"}');
    expect(stop(ws, "k2", ONE)?.reason).toMatch(/^plan 1's review has not settled/);
  });

  it("names no file for a serial the frontmatter does not carry", () => {
    const ws = temp();
    plant(ws, ".tmp/repo/plans/5-x.md", item(6, "status: ready", "reviews: 0", "strategy: default"));
    expect(stop(ws, "k3", closing("plan 5 (strategy: default)"))).toBeNull();
  });
});

describe("a turn that saved reviewed items", () => {
  const stamped = (ws: string, sid: string) => {
    say(ws, sid, { prompt: "plan it" });
    const lines = [
      path.join(ws, "other.md"),
      path.join(ws, ".tmp/repo/plans/9-missing.md"),
      path.join(ws, ".tmp/repo/plans/4-bare.md"),
      path.join(ws, ".tmp/repo/plans/2-nostatus.md"),
      path.join(ws, ".tmp/repo/plans/3-nostrategy.md"),
      path.join(ws, ".tmp/repo/plans/7-ok.md"),
      path.join(ws, ".tmp/repo/roadmaps/3-r.md"),
    ];
    plant(ws, "other.md", "not an item");
    plant(ws, ".tmp/repo/plans/4-bare.md", "no frontmatter at all");
    plant(ws, ".tmp/repo/plans/2-nostatus.md", item(2, "reviews: 1", "strategy: default"));
    plant(ws, ".tmp/repo/plans/3-nostrategy.md", item(3, "a line with no key", "status: ready", "reviews: 1"));
    plant(ws, ".tmp/repo/plans/7-ok.md", item(7, ...SETTLED));
    plant(ws, ".tmp/repo/roadmaps/3-r.md", item(3, "status: draft", "reviews: 1", "strategy: default"));
    plant(ws, `.tmp/repo/sessions/${sid}/approvals.txt`, lines.join("\n") + "\n");
  };

  it("asks for a closing line over only the items that can be approved", () => {
    const ws = temp();
    stamped(ws, "p1");
    expect(stop(ws, "p1", "Saved.")?.reason).toBe(
      'end with: Reply "y" to run plan 7 (strategy: default), then roadmap 3 (strategy: default), or "y review-fast" / "y review-deep", or "h" / "h fast" / "h deep" for a fresh session.',
    );
  });
});

describe("a reply of y", () => {
  it("approves nothing without a session", () => {
    const ws = temp();
    const tp = transcript(ws, closing("plan 1 (strategy: default)"));
    expect(say(ws, "", { prompt: "y", transcript_path: tp })).toStrictEqual(["sessionGate=auto"]);
  });

  it("refuses a strategy change when the plan has no frontmatter block to carry it", () => {
    const ws = temp();
    const file = plant(ws, ".tmp/repo/plans/2-x.md", `---\nserial: 2\n${SETTLED.join("\n")}\n---`);
    plant(ws, ".tmp/repo/sessions/y1/approvals.txt", `${file}\n`);
    const tp = transcript(ws, closing("plan 2 (strategy: default)"));
    expect(say(ws, "y1", { prompt: "y review-fast", transcript_path: tp })).toContain(
      "y did not approve plan 2: strategy review-fast could not be written (no frontmatter)",
    );
  });
});

/** A new plan saved through the hook the way the host lands it, with its review round done. */
function reviewedPlan(ws: string, sid: string): string {
  const out = send(ws, {
    hook_event_name: "PreToolUse",
    session_id: sid,
    tool_input: { content: VALID_PLAN, file_path: ".tmp/repo/plans/new.md" },
    tool_name: "Write",
  });
  const landed = out?.hookSpecificOutput.updatedInput;
  const file = landed?.file_path ?? "";
  fs.writeFileSync(file, (landed?.content ?? "").replace("reviews: 0", "reviews: 1"));
  return file;
}

describe("a reply of y to a plan that cannot be rewritten", () => {
  it("refuses the strategy change and leaves the plan as it was", () => {
    const ws = temp();
    const plan = reviewedPlan(ws, "y2");
    fs.chmodSync(plan, 0o444);
    const tp = transcript(ws, closing("plan 1 (strategy: default)"));
    const lines = say(ws, "y2", { prompt: "y review-fast", transcript_path: tp });
    expect(lines.find((l) => l.startsWith("y did not approve"))).toContain("plan 1: strategy review-fast could not be");
    expect(fs.readFileSync(plan, "utf8")).toContain("strategy: default");
  });
});

describe("a reply of h", () => {
  // A newline cannot be part of a file name on Windows.
  it.skipIf(process.platform === "win32")("refuses when the session id would break the handoff", () => {
    const ws = temp();
    const sid = "s1\n## Extra";
    const file = plant(ws, ".tmp/repo/plans/1-x.md", item(1, ...SETTLED));
    plant(ws, `.tmp/repo/sessions/${sid}/approvals.txt`, `${file}\n`);
    const tp = transcript(ws, closing("plan 1 (strategy: default)"));
    const lines = say(ws, sid, { prompt: "h", transcript_path: tp });
    expect(lines.some((l) => l.startsWith("h did not hand off plan 1: the handoff could not be written"))).toBe(true);
    expect(fs.readdirSync(path.join(ws, ".tmp/repo/handoffs"))).toStrictEqual([]);
  });
});
