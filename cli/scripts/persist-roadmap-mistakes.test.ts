import { describe, expect, it } from "vitest";

import { DRAFT_ROADMAP, LEGACY_ROADMAP } from "./__fixtures__/persist-bodies.ts";
import { read, useTmpWs, withEntries } from "./__fixtures__/persist-plan-kit.ts";
import { NAME_LINE, savedLegacy, savedRoadmap, update } from "./__fixtures__/persist-roadmap-kit.ts";
import { persistRoadmap } from "./persist-roadmap.ts";

const tmpWs = useTmpWs("persist-roadmap-");
const ENTRY = "- slice: plan 22 found lifecycle hooks must be async → D2 now says async and slice 3 waits on it";
const SECOND = "- review: slice 2 had no runnable gate → Verify 3.1 runs the suite";

function withKeys(keys: string) {
  return DRAFT_ROADMAP.replace(NAME_LINE, `${keys}${NAME_LINE}`);
}

describe("roadmap Previous mistakes section", () => {
  it("is required on a new roadmap, which starts its review count at 0", () => {
    const ws = tmpWs();
    const bare = DRAFT_ROADMAP.replace("\n## Previous mistakes\n(none)\n", "");
    const r = persistRoadmap({ content: bare, workspaceRoot: ws });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/missing ## Previous mistakes; end a new roadmap with it and \(none\)/);
    expect(read(savedRoadmap(ws))).toMatch(/^reviews: 0$/m);
  });

  it("rejects an unknown entry kind and a section that is not last", () => {
    const ws = tmpWs();
    const bad = persistRoadmap({ content: withEntries(DRAFT_ROADMAP, "- oops: a → b"), workspaceRoot: ws });
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/feedback\|verify\|review\|premise\|decision\|slice/);

    const moved = DRAFT_ROADMAP.replace("\n## Previous mistakes\n(none)\n", "").replace(
      "## Verify",
      "## Previous mistakes\n(none)\n\n## Verify",
    );

    expect(persistRoadmap({ content: moved, workspaceRoot: ws }).error).toMatch(/must be the last heading/);
  });
});

describe("roadmap Previous mistakes entries", () => {
  it("accepts a slice entry and keeps every saved entry", () => {
    const ws = tmpWs();
    const abs = savedRoadmap(ws, withEntries(DRAFT_ROADMAP, ENTRY));
    expect(update(ws, abs, withEntries(DRAFT_ROADMAP, ENTRY, SECOND)).ok).toBe(true);
    const changed = update(ws, abs, withEntries(DRAFT_ROADMAP, ENTRY.replace("async", "sync"), SECOND));
    expect(changed.ok).toBe(false);
    expect(changed.error).toContain(`keep this entry unchanged: ${ENTRY}`);
    expect(update(ws, abs, withEntries(DRAFT_ROADMAP, SECOND)).ok).toBe(false);
  });

  it("saves a decision entry and denies an update that edits or drops it", () => {
    const ws = tmpWs();
    const decision = "- decision: a → b because c";
    const abs = savedRoadmap(ws, withEntries(DRAFT_ROADMAP, decision));

    for (const content of [
      withEntries(DRAFT_ROADMAP, "(none)"),
      withEntries(DRAFT_ROADMAP, decision.replace("because c", "because d")),
    ]) {
      const u = update(ws, abs, content);
      expect(u.ok).toBe(false);
      expect(u.error).toContain(`keep this entry unchanged: ${decision}`);
    }
  });
});

describe("roadmap review rounds", () => {
  it("lock only after a settled review round", () => {
    const ws = tmpWs();
    const abs = savedRoadmap(ws);
    const denied = update(ws, abs, withKeys("status: locked\n"));
    expect(denied.ok).toBe(false);
    expect(denied.error).toMatch(/status locked needs reviews: 1 or more; run \/review-roadmap \{n\}/);
    const r = update(ws, abs, withKeys("status: locked\nreviews: 1\n"));
    expect(r.ok, r.error).toBe(true);
    expect(read(abs)).toMatch(/^reviews: 1$/m);
  });

  it("keep the saved count on a body-only save and never lower or drop it", () => {
    const ws = tmpWs();
    const abs = savedRoadmap(ws);
    expect(update(ws, abs, withKeys("reviews: 2\n")).ok).toBe(true);
    expect(update(ws, abs, DRAFT_ROADMAP).ok).toBe(true);
    expect(read(abs)).toMatch(/^reviews: 2$/m);
    const lowered = update(ws, abs, withKeys("reviews: 1\n"));
    expect(lowered.error).toMatch(/reviews cannot go down \(saved 2, got 1\)/);
    expect(update(ws, abs, read(abs).replace("reviews: 2\n", "")).error).toMatch(/keep reviews: 2/);
  });
});

describe("a roadmap saved before the section", () => {
  it("and the count stays editable", () => {
    const ws = tmpWs();
    const legacy = LEGACY_ROADMAP.replace("\n## Previous mistakes\n(none)\n", "");
    const abs = savedLegacy(ws, legacy, "status: locked");
    const r = update(ws, abs, legacy.replace("1 [ ] Title", "1 [x] Title"));
    expect(r.ok, r.error).toBe(true);
    expect(read(abs)).toMatch(/^status: locked$/m);
  });

  it("keeps a roadmap saved without Usage passing and denies Usage after Context", () => {
    const ws = tmpWs();
    const noUsage = LEGACY_ROADMAP.replace(/## Usage\n[\s\S]*?(?=## Context)/, "");
    const abs = savedLegacy(ws, noUsage);
    expect(update(ws, abs, noUsage.replace("Names stay reserved.", "Names stay put.")).ok).toBe(true);
    const moved = noUsage.replace("## Decisions", "## Usage\nNo visible change: x\n\n## Decisions");
    const bad = update(ws, abs, moved);
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain("## Usage must come right after ## Goal");
  });
});
