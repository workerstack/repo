import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DRAFT_ROADMAP, savedOk } from "./__fixtures__/persist-bodies.ts";
import { useTmpWs } from "./__fixtures__/persist-plan-kit.ts";
import { extra, update } from "./__fixtures__/persist-roadmap-kit.ts";
import { locationOk } from "./persist-roadmap-shape.ts";
import { persistRoadmap, prepareRoadmapUpdate } from "./persist-roadmap.ts";

const tmpWs = useTmpWs("persist-roadmap-");
const CREATED = "2026-11-09T10:15:00Z";
const ROADMAPS = ".repo/roadmaps";

function save(content: string, ws = tmpWs()) {
  return persistRoadmap({ content, created: CREATED, workspaceRoot: ws });
}

function sliceRule(n: number) {
  return `slice ${n} needs "N [ ] {title, 2–6 words}: {one sentence}"`;
}

function cap(n: number) {
  return `${n} lines above ## Previous mistakes, the cap is 60; move detail into the slice plans`;
}

const SLICE_1 = "1 [ ] auth types: Reserved names list the new skills.\n";
const SLICE_2 = "2 [ ] commit diff pass: Commit skills strip narrating comments.\n";
const WIN_LOCATION = "C:\\Users\\me\\app\\.repo\\plans\\21-json-export-20261109T101500Z.md";
const ONE = "1 [ ] slice number 1: Slice 1 ships one change.\n";

// The draft with n one-line slices; `location` adds an indented Location line under each.
function withSlices(n: number, location?: (i: number) => string) {
  const lines = Array.from({ length: n }, (_, i) => {
    const line = `${i + 1} [ ] slice number ${i + 1}: Slice ${i + 1} ships one change.`;

    return location === undefined ? line : `${line}\n      Location: ${location(i + 1)}`;
  });

  return DRAFT_ROADMAP.replace(SLICE_1 + SLICE_2, `${lines.join("\n")}\n`)
    .replace("3 [ ] Verify", `${n + 1} [ ] Verify`)
    .replace("3.1 [ ]", `${n + 1}.1 [ ]`);
}

// Lines above Previous mistakes in a saved file, frontmatter included, Location lines not counted.
function above(text: string) {
  const lines = text.split("\n");

  return lines.slice(0, lines.indexOf("## Previous mistakes")).filter((l) => !/^\s+Location: /.test(l)).length;
}

// Slices that put a saved pointer roadmap at exactly `lines` lines above Previous mistakes.
function slicesFor(lines: number) {
  const base = save(withSlices(2));
  expect(base.ok, base.error).toBe(true);

  return 2 + lines - above(savedOk(base).content);
}

describe("a fresh pointer roadmap", () => {
  it("saves with no Goal, Usage or Decisions", () => {
    const r = save(DRAFT_ROADMAP);
    expect(r.ok, r.error).toBe(true);
    expect(r.content).not.toMatch(/^## (Goal|Usage|Context|Decisions|Watch-outs)$/m);
  });

  it.each(["Goal", "Usage", "Context", "Decisions", "Watch-outs"])("denies ## %s", (h) => {
    const ws = tmpWs();
    const r = save(DRAFT_ROADMAP.replace("## Order", `## ${h}\n- one line about ${h}.\n\n## Order`), ws);
    expect(r.ok).toBe(false);
    expect(r.errors).toContain(extra(h));
    expect(fs.readdirSync(path.join(ws, ROADMAPS))).toStrictEqual([]);
  });

  it("is denied without the card", () => {
    const r = save(DRAFT_ROADMAP.replace(/WHAT[\s\S]*?DONE.*\n\n/, ""));
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("start with the 5-line card after the title: WHAT, WHY, RISK, TOUCH, DONE");
  });
});

describe("a fresh roadmap slice", () => {
  const old =
    "1 [ ] Title: auth types\n      Goal: Reserved names list the new skills.\n      Why: Later slices add skills.\n";

  const badSlices = [
    { from: SLICE_1, n: 1, to: old, what: "an old two-line slice" },
    { from: SLICE_2, n: 2, to: "2 [ ] commit: Commit skills strip narrating comments.\n", what: "a 1-word title" },
    {
      from: SLICE_2,
      n: 2,
      to: "2 [ ] commit diff pass for every skill file: Commit skills strip narrating comments.\n",
      what: "a 7-word title",
    },
    {
      from: SLICE_2,
      n: 2,
      to: "2 [ ] commit diff pass: Commit skills strip narrating comments. They also lint.\n",
      what: "two sentences",
    },
    { from: SLICE_2, n: 2, to: "2 [ ] commit diff pass\n", what: "no sentence" },
  ];

  it.each(badSlices)("denies $what", ({ n, from, to }) => {
    const r = save(DRAFT_ROADMAP.replace(from, to));
    expect(r.ok).toBe(false);
    expect(r.errors).toContain(sliceRule(n));
  });
});

describe("the pointer roadmap line cap", () => {
  it("saves 60 lines above Previous mistakes and denies 61", () => {
    const n = slicesFor(60);
    const at = save(withSlices(n));
    expect(at.ok, at.error).toBe(true);
    expect(above(savedOk(at).content)).toBe(60);
    const ws = tmpWs();
    const over = save(withSlices(n + 1), ws);
    expect(over.ok).toBe(false);
    expect(over.errors).toContain(cap(61));
    expect(fs.readdirSync(path.join(ws, ROADMAPS))).toStrictEqual([]);
  });

  it("does not count Location lines", () => {
    const ws = tmpWs();
    const n = slicesFor(60);

    function plan(i: number) {
      return path.join(ws, ".repo/plans", `${i}-slice-number-${i}-20261109T101500Z.md`);
    }

    const r = save(withSlices(n, plan), ws);
    expect(r.ok, r.error).toBe(true);
    expect(savedOk(r).content.split("\n").indexOf("## Previous mistakes")).toBe(60 + n);
  });
});

describe("a Windows plan Location", () => {
  it("saves in a slice", () => {
    const r = save(DRAFT_ROADMAP.replace(SLICE_1, `${SLICE_1}      Location: ${WIN_LOCATION}\n`));
    expect(r.ok, r.error).toBe(true);
  });

  it("is accepted under win32 and posix path rules, and a roadmap path is not", () => {
    for (const p of [path.win32, path.posix]) {
      expect(locationOk(WIN_LOCATION, p), p === path.win32 ? "win32" : "posix").toBe(true);
      expect(locationOk(".repo\\roadmaps\\nope.md", p)).toBe(false);
    }
  });
});

describe("a pointer roadmap update", () => {
  it("is denied past 60 lines and allowed when it adds a Location line", () => {
    const ws = tmpWs();
    const n = slicesFor(60);
    const first = save(withSlices(n), ws);
    expect(first.ok, first.error).toBe(true);
    const abs = path.join(ws, savedOk(first).path);
    const grown = prepareRoadmapUpdate({ content: withSlices(n + 1), filePath: abs, workspaceRoot: ws });
    expect(grown.ok).toBe(false);
    expect(grown.errors).toContain(cap(61));
    const plan = path.join(ws, ".repo/plans/9-slice-number-1-20261109T101500Z.md");
    const located = withSlices(n).replace(ONE, `${ONE}      Location: ${plan}\n`);
    const r = update(ws, abs, located.replace("1 [ ] slice number 1", "1 [x] slice number 1"));
    expect(r.ok, r.error).toBe(true);
  });

  it("is denied when it adds ## Decisions", () => {
    const ws = tmpWs();
    const first = save(DRAFT_ROADMAP, ws);
    expect(first.ok, first.error).toBe(true);
    const abs = path.join(ws, savedOk(first).path);
    const content = DRAFT_ROADMAP.replace("## Order", "## Decisions\n- D1. Fetch stays upstream.\n\n## Order");
    const r = prepareRoadmapUpdate({ content, filePath: abs, workspaceRoot: ws });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain(extra("Decisions"));
  });
});
