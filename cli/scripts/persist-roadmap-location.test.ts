import path from "node:path";

import { describe, expect, it } from "vitest";

import { DRAFT_ROADMAP, savedOk } from "./__fixtures__/persist-bodies.ts";
import { read, useTmpWs } from "./__fixtures__/persist-plan-kit.ts";
import { CREATED, NAME_LINE, update } from "./__fixtures__/persist-roadmap-kit.ts";
import { persistRoadmap } from "./persist-roadmap.ts";

const tmpWs = useTmpWs("persist-roadmap-");
const SLICE_1 = "1 [ ] auth types: Reserved names list the new skills.\n";
function withLocation(location: string) {
  return DRAFT_ROADMAP.replace(SLICE_1, `${SLICE_1}      Location: ${location}\n`);
}

describe("a slice Location", () => {
  it("rejects one outside the plans dir", () => {
    const r = persistRoadmap({ content: withLocation(".tmp/repo/roadmaps/nope.md"), workspaceRoot: tmpWs() });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("location");
  });

  it("accepts a workspace-relative plan Location", () => {
    const content = withLocation(".tmp/repo/plans/14-auth-types-20261025T165531Z.md");
    expect(persistRoadmap({ content, workspaceRoot: tmpWs() }).ok).toBe(true);
  });
});

describe("a fresh roadmap", () => {
  it("rejects a create that is locked or already checked", () => {
    const ws = tmpWs();
    const locked = DRAFT_ROADMAP.replace(NAME_LINE, `status: locked\n${NAME_LINE}`);
    const lockedResult = persistRoadmap({ content: locked, workspaceRoot: ws });
    expect(lockedResult.ok).toBe(false);
    expect(lockedResult.errors).toContain("fresh status");
    const checked = DRAFT_ROADMAP.replace("1 [ ] auth types", "1 [x] auth types");
    const checkedResult = persistRoadmap({ content: checked, workspaceRoot: ws });
    expect(checkedResult.ok).toBe(false);
    expect(checkedResult.errors).toContain("fresh [x]");
  });
});

describe("a saved roadmap's status", () => {
  it("is kept when the next full write omits status", () => {
    const ws = tmpWs();
    const first = persistRoadmap({ content: DRAFT_ROADMAP, created: CREATED, workspaceRoot: ws });
    expect(first.ok).toBe(true);
    const abs = path.join(ws, savedOk(first).path);
    const locked = update(ws, abs, DRAFT_ROADMAP.replace(NAME_LINE, `status: locked\nreviews: 1\n${NAME_LINE}`));
    expect(locked.ok).toBe(true);
    const again = update(ws, abs, DRAFT_ROADMAP);
    expect(again.ok).toBe(true);
    expect(read(path.join(ws, savedOk(again).path))).toMatch(/^status: locked$/m);
  });

  it("moves when the next full write names a new one", () => {
    const ws = tmpWs();
    const first = persistRoadmap({ content: DRAFT_ROADMAP, created: CREATED, workspaceRoot: ws });
    const abs = path.join(ws, savedOk(first).path);
    const started = DRAFT_ROADMAP.replace(NAME_LINE, `status: in-progress\n${NAME_LINE}`);
    const moved = update(ws, abs, started);
    expect(moved.ok).toBe(true);
    expect(read(path.join(ws, savedOk(moved).path))).toMatch(/^status: in-progress$/m);
  });
});
