import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { VALID_PLAN, savedOk } from "./fixtures/persist-bodies.ts";
import { useTmpWs } from "./fixtures/persist-plan-kit.ts";
import { persistPlan, preparePlanUpdate } from "./persist-plan.ts";
import { fencedLineSet, sectionBodies } from "./persist-sections.ts";

const tmpWs = useTmpWs();

const F = "```";
const noUsage = VALID_PLAN.replace(/## Usage\n[\s\S]*?(?=## Context)/, "");
const withUsage = (usage: string) => noUsage.replace("## Context", `## Usage\n${usage}\n\n## Context`);
const save = (content: string) => persistPlan({ content, workspaceRoot: tmpWs() });

describe("usage section denials", () => {
  it("denies a fresh plan without Usage and says what to show", () => {
    const r = save(noUsage);
    expect(r.ok).toBe(false);
    expect(r.error).toContain(
      'missing ## Usage after ## Goal: show what a person types and sees, before and after, in fenced blocks, or one "No visible change:" line',
    );
  });

  it("denies a Usage that holds only prose", () => {
    const r = save(withUsage("Run the thing and it works."));
    expect(r.ok).toBe(false);
    expect(r.error).toContain('## Usage needs a fenced example or a "No visible change:" line');
  });

  it("saves a No visible change line", () => {
    expect(save(withUsage("No visible change: internal refactor")).ok).toBe(true);
  });

  it("ignores headings and boxes inside a Usage fence", () => {
    const r = save(withUsage(`${F}markdown\n## Example\n1 [x] done\n${F}`));
    expect(r.ok, r.error).toBe(true);
  });

  it("keeps an inner fence inside a longer outer fence", () => {
    const r = save(withUsage(`${F}\`markdown\n${F}console\n$ x\n${F}\n## Goal\n${F}\``));
    expect(r.ok, r.error).toBe(true);
  });
});

describe("usage section fences", () => {
  it("names an unclosed fence instead of unrelated heading errors", () => {
    const text = withUsage(`${F}console\n$ x`);
    const r = save(text);
    expect(r.ok).toBe(false);
    const line = text.split("\n").findIndex((l) => l === `${F}console`) + 1;
    expect(r.error).toContain(`unclosed code fence at line ${line}: close it with the same fence`);
    expect(r.error).not.toContain("heading order");
  });

  it("finds sections and fences per CommonMark", () => {
    const text = `## A\n${F}\n## Inside\n${F}\n## B\n`;
    expect(sectionBodies(text).order).toStrictEqual(["A", "B"]);
    const lines = [`${F}${F.slice(0, 1)}md`, F, "## x", F, `${F}${F.slice(0, 1)}`, "after"];
    const { fenced, unclosed } = fencedLineSet(lines);
    expect([...fenced].sort()).toStrictEqual([0, 1, 2, 3, 4]);
    expect(unclosed).toBeNull();
  });
});

describe("usage section on update", () => {
  it("lets an update to a saved plan without Usage pass, and denies Usage below Context", () => {
    const ws = tmpWs();
    const r = persistPlan({ content: withUsage("No visible change: x"), workspaceRoot: ws });
    expect(r.ok, r.error).toBe(true);
    const abs = path.join(ws, savedOk(r).path);
    const legacy = fs.readFileSync(abs, "utf8").replace(/## Usage\n[\s\S]*?(?=## Context)/, "");
    fs.writeFileSync(abs, legacy);
    const flipped = legacy.replace("1.1 [ ]", "1.1 [x]");
    expect(preparePlanUpdate({ content: flipped, filePath: abs, workspaceRoot: ws }).ok).toBe(true);
    const moved = legacy.replace("## Constraints", "## Usage\nNo visible change: x\n\n## Constraints");
    const bad = preparePlanUpdate({ content: moved, filePath: abs, workspaceRoot: ws });
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain("## Usage must come right after ## Goal");
  });
});
