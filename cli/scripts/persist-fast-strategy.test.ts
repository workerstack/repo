import path from "node:path";

import { describe, expect, it } from "vitest";

import { savedOk } from "./__fixtures__/persist-bodies.ts";
import { updateFastPlan } from "./__fixtures__/persist-fast-plan-kit.ts";
import { SENT as ROADMAP_SENT, updateRoadmap } from "./__fixtures__/persist-fast-roadmap-kit.ts";
import { read, useTmpWs } from "./__fixtures__/persist-plan-kit.ts";
import { fastPlanLineCount } from "./persist-fast-plan-validate.ts";
import { persistFastPlan } from "./persist-fast-plan.ts";
import { fastRoadmapLineCount } from "./persist-fast-roadmap-validate.ts";
import { persistFastRoadmap } from "./persist-fast-roadmap.ts";
import type { Strategy } from "./strategy.types.ts";

const tmpWs = useTmpWs("persist-fast-strategy-");
const CREATED = "2026-11-13T03:00:00Z";
const ADVICE_TEXT = "advice: {free|spawn-fast|spawn-deep} because {reason}, at most 100 characters";

const PLAN_SENT = [
  "FAST_PLAN_NAME: add tmp ignore",
  "commit: chore: ignore .tmp",
  "# anything",
  "",
  "## Goal",
  "Ignore `.tmp/` in git.",
  "",
  "## Steps",
  "1 [ ] add `.tmp/` to `.gitignore`",
  "",
  "## Verify",
  "2 [ ] `git check-ignore .tmp/x` prints it",
  "",
].join("\n");

const KINDS = [
  {
    kind: "fast plan",
    lineCount: fastPlanLineCount,
    save: (content: string, strategy: Strategy, ws: string) =>
      persistFastPlan({ content, created: CREATED, strategy, workspaceRoot: ws }),
    sent: PLAN_SENT,
    update: updateFastPlan,
  },
  {
    kind: "fast roadmap",
    lineCount: fastRoadmapLineCount,
    save: (content: string, strategy: Strategy, ws: string) =>
      persistFastRoadmap({ content, created: CREATED, strategy, workspaceRoot: ws }),
    sent: ROADMAP_SENT,
    update: updateRoadmap,
  },
] as const;

/** `sent` with `line` right after its name line. */
function withLine(sent: string, line: string): string {
  const [name, ...rest] = sent.split("\n");

  return [name, line, ...rest].join("\n");
}

describe.each(KINDS)("$kind strategy and advice", ({ save, sent, lineCount }) => {
  it("saves the strategy it is given and a sent advice in the frontmatter, and neither in the body", () => {
    const r = savedOk(save(withLine(sent, "advice: free because one file"), "spawn-fast", tmpWs()));
    const [, head = "", body = ""] = r.content.split("---\n");
    expect(head).toMatch(/^strategy: spawn-fast\nadvice: free because one file\n$/m);
    expect(body).not.toMatch(/^(strategy|advice):/m);
  });

  it("saves its own strategy over a sent strategy line, and no advice when none is sent", () => {
    const r = savedOk(save(withLine(sent, "strategy: spawn-deep"), "free", tmpWs()));
    expect(r.content).toMatch(/^strategy: free$/m);
    expect(r.content).not.toMatch(/^(advice|strategy: spawn-deep)/m);
  });

  it("denies a bad advice with the plan's text", () => {
    for (const advice of ["advice: maybe later", `advice: free because ${"x".repeat(100)}`])
      expect(save(withLine(sent, advice), "free", tmpWs()).errors).toContain(ADVICE_TEXT);
  });

  it("counts neither the strategy nor the advice line toward the cap", () => {
    const bare = savedOk(save(sent, "free", tmpWs())).content;
    const full = savedOk(save(withLine(sent, "advice: free because one file"), "free", tmpWs())).content;
    expect(full.split("\n").length - bare.split("\n").length).toBe(1);
    expect(lineCount(full)).toBe(lineCount(bare));
    expect(lineCount(bare)).toBe(lineCount(bare.replace(/^strategy:.*\n/m, "")));
  });
});

describe.each(KINDS)("$kind rewrites", ({ save, sent, update }) => {
  it("keeps the saved strategy and advice when a rewrite sends neither", () => {
    const ws = tmpWs();
    const r = savedOk(save(withLine(sent, "advice: spawn-deep because two files"), "spawn-fast", ws));
    const abs = path.join(ws, r.path);
    const bare = read(abs).replaceAll(/^(?:strategy|advice):.*\n/gm, "");
    const u = update(ws, abs, bare);
    expect(u.ok, u.error).toBe(true);
    expect(read(abs)).toMatch(/^strategy: spawn-fast$/m);
    expect(read(abs)).toMatch(/^advice: spawn-deep because two files$/m);
  });

  it("denies a rewrite to an unknown strategy", () => {
    const ws = tmpWs();
    const r = savedOk(save(sent, "free", ws));
    const abs = path.join(ws, r.path);
    expect(update(ws, abs, read(abs).replace("strategy: free", "strategy: fast")).errors).toContain(
      "strategy: free|spawn-fast|spawn-deep",
    );
  });
});
