import { describe, expect, it } from "vitest";

import { DRAFT_ROADMAP } from "./__fixtures__/persist-bodies.ts";
import { SENT, saveRoadmap } from "./__fixtures__/persist-fast-roadmap-kit.ts";
import { useTmpWs } from "./__fixtures__/persist-plan-kit.ts";
import { persistRoadmap } from "./persist-roadmap.ts";

const tmpWs = useTmpWs("persist-roadmap-parallel-");

const DEEP = [
  "1 [ ] auth types: Reserved names list the new skills.",
  "2 [ ] commit diff pass: Commit skills strip narrating comments.",
];

const FAST = ["1 [ ] ignore tmp: add .tmp/ to .gitignore", "2 [ ] ignore logs: add *.log to .gitignore"];

const DISJOINT = "slices need disjoint paths";

const SKILL = "agents/skills/commit/SKILL.md";

function saveDeep(content: string) {
  return persistRoadmap({ content, created: "2026-11-09T10:15:00Z", strategy: "free", workspaceRoot: tmpWs() });
}

/** `body` with slice i ending `(parallel: lists[i])`, unless that list is null. */
function mark(body: string, slices: string[], lists: (string | null)[]) {
  let out = body;

  for (const [i, s] of slices.entries()) {
    const list = lists[i];

    if (list !== undefined && list !== null) out = out.replace(s, `${s} (parallel: ${list})`);
  }

  return out;
}

/** A fresh save of the deep and of the fast roadmap with the same lists. */
function saves(...lists: (string | null)[]) {
  return [saveDeep(mark(DRAFT_ROADMAP, DEEP, lists)), saveRoadmap(mark(SENT, FAST, lists), tmpWs())];
}

describe("parallel slices on a roadmap and a fast roadmap", () => {
  it.each([
    { one: "cli/init.ts, references/INDEX.md", two: "agents/skills/commit/, cli/lint/*.test.ts" },
    { one: "cli/*.ts", two: "cli/bench/" },
  ])("save $one beside $two", ({ one, two }) => {
    for (const r of saves(one, two)) expect(r.ok, r.error).toBe(true);
  });

  it.each([
    { error: "slice 2 is parallel alone; parallel needs two or more adjacent slices", one: null, two: "a.ts" },
    { error: "slice 1 is parallel with no paths; list the paths it changes after parallel:", one: "", two: "a.ts" },
    {
      error: `parallel slices 1 and 2 both list cli/init.ts; parallel ${DISJOINT}`,
      one: "cli/init.ts",
      two: "cli\\init.ts",
    },
    {
      error: `parallel slices 1 and 2 overlap at agents/skills/ and ${SKILL}; parallel ${DISJOINT}`,
      one: "agents/skills/",
      two: SKILL,
    },
    {
      error: `parallel slices 1 and 2 overlap at cli/*.ts and cli/init.ts; parallel ${DISJOINT}`,
      one: "cli/*.ts",
      two: "cli/init.ts",
    },
  ])("deny $one beside $two", ({ error, one, two }) => {
    for (const r of saves(one, two)) expect(r.errors).toContain(error);
  });
});

describe("the one-sentence check beside a marker", () => {
  it("still denies two sentences before the marker", () => {
    const deep = DRAFT_ROADMAP.replace("narrating comments.", "narrating comments. They also lint. (parallel: a.ts)");
    expect(saveDeep(deep).errors).toContain('slice 2 needs "N [ ] {title, 2–6 words}: {one sentence}"');

    const fast = SENT.replace(String(FAST[1]), "2 [ ] ignore logs: Add logs. Add more. (parallel: a.ts)");
    expect(saveRoadmap(fast, tmpWs()).errors).toContain('slice 2 needs "N [ ] {title}: {one sentence}"');
  });

  it("reads a mid-line marker as sentence text", () => {
    const r = saveDeep(DRAFT_ROADMAP.replace("strip narrating", "(parallel: a.ts) strip narrating"));
    expect(r.ok, r.error).toBe(true);
  });
});
