import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { persistRoadmap } from "./persist-roadmap.mjs";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function tmpWs() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "persist-roadmap-"));
  tmpDirs.push(dir);
  return dir;
}

const DRAFT = `ROADMAP_NAME: auth program

# auth-program

## Goal
Ship auth as two plans. The second plan waits on the first. Names stay reserved.

## Context
- Init owns reserved names

## Decisions
- D1. Fetch stays upstream. Rejected: a vendored snapshot.

## Order
1 [ ] Title: auth types
      Goal: Reserved names list the new skills.
      Why: Later slices add skills. This slot keeps init and INDEX together.
2 [ ] Title: commit diff pass
      Goal: Commit skills strip narrating comments.
      Why: Every later land goes through commit.

## Watch-outs
- Hook ignores docs until wired

## Verify
3 [ ] Verify
3.1 [ ] both slices are done
`;

describe("persistRoadmap", () => {
  it("persists a two-slice draft with no Location at serial 1", () => {
    const ws = tmpWs();
    const created = "2026-10-25T18:00:00Z";
    const r = persistRoadmap({ workspaceRoot: ws, content: DRAFT, created });
    expect(r.ok).toBe(true);
    expect(r.serial).toBe(1);
    expect(r.path).toBe("docs/roadmaps/1-auth-program-20261025T180000Z.md");
    const text = fs.readFileSync(path.join(ws, r.path!), "utf8");
    expect(text).toMatch(/^status: draft$/m);
    expect(text).not.toMatch(/^\s+Location:/m);
    expect(text).toMatch(/Title: auth types/);
    expect(text).toMatch(/Title: commit diff pass/);
  });

  it("rejects a one-slice roadmap", () => {
    const ws = tmpWs();
    const one = DRAFT.replace(
      /2 \[ \] Title: commit diff pass\n      Goal: Commit skills strip narrating comments\.\n      Why: Every later land goes through commit\.\n/,
      "",
    );
    const r = persistRoadmap({ workspaceRoot: ws, content: one });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("slices");
    expect(fs.existsSync(path.join(ws, "docs/roadmaps"))).toBe(true);
    expect(fs.readdirSync(path.join(ws, "docs/roadmaps"))).toEqual([]);
  });

  it("rejects a Goal that is not 1 to 3 sentences", () => {
    const ws = tmpWs();
    const bad = DRAFT.replace(
      "## Goal\nShip auth as two plans. The second plan waits on the first. Names stay reserved.\n",
      "## Goal\nOne. Two. Three. Four.\n",
    );
    const r = persistRoadmap({ workspaceRoot: ws, content: bad });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("goal");
  });

  it("keeps the serial when the same file is written again", () => {
    const ws = tmpWs();
    const created = "2026-10-25T18:00:00Z";
    const first = persistRoadmap({ workspaceRoot: ws, content: DRAFT, created });
    expect(first.ok).toBe(true);
    const again = persistRoadmap({
      workspaceRoot: ws,
      content: String(first.content).replace(
        "This slot keeps init and INDEX together.",
        "This slot keeps init and INDEX aligned.",
      ),
      filePath: path.join(ws, first.path!),
    });
    expect(again.ok).toBe(true);
    expect(again.serial).toBe(1);
    expect(again.path).toBe(first.path);
    expect(fs.readdirSync(path.join(ws, "docs/roadmaps"))).toEqual([
      "1-auth-program-20261025T180000Z.md",
    ]);
    expect(fs.readFileSync(path.join(ws, again.path!), "utf8")).toMatch(
      /INDEX aligned/,
    );
  });

  it("rejects a Location outside the plans dir", () => {
    const ws = tmpWs();
    const rel = DRAFT.replace(
      "1 [ ] Title: auth types\n",
      "1 [ ] Title: auth types\n      Location: docs/roadmaps/nope.md\n",
    );
    const r = persistRoadmap({ workspaceRoot: ws, content: rel });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("location");
  });

  it("accepts a workspace-relative plan Location", () => {
    const ws = tmpWs();
    const rel = DRAFT.replace(
      "1 [ ] Title: auth types\n",
      "1 [ ] Title: auth types\n      Location: .tmp/grunt/plans/14-auth-types-20261025T165531Z.md\n",
    );
    const r = persistRoadmap({ workspaceRoot: ws, content: rel });
    expect(r.ok).toBe(true);
  });

  it("rejects a fresh create that is locked or already checked", () => {
    const ws = tmpWs();
    const locked = DRAFT.replace(
      "ROADMAP_NAME: auth program\n",
      "status: locked\nROADMAP_NAME: auth program\n",
    );
    const lockedResult = persistRoadmap({ workspaceRoot: ws, content: locked });
    expect(lockedResult.ok).toBe(false);
    expect(lockedResult.errors).toContain("fresh status");
    const checked = DRAFT.replace("1 [ ] Title: auth types", "1 [x] Title: auth types");
    const checkedResult = persistRoadmap({ workspaceRoot: ws, content: checked });
    expect(checkedResult.ok).toBe(false);
    expect(checkedResult.errors).toContain("fresh [x]");
  });

  it("keeps a locked status when the next full write omits status", () => {
    const ws = tmpWs();
    const created = "2026-10-25T18:00:00Z";
    const first = persistRoadmap({ workspaceRoot: ws, content: DRAFT, created });
    expect(first.ok).toBe(true);
    const locked = persistRoadmap({
      workspaceRoot: ws,
      content: DRAFT.replace(
        "ROADMAP_NAME: auth program\n",
        "status: locked\nROADMAP_NAME: auth program\n",
      ),
      filePath: path.join(ws, first.path!),
    });
    expect(locked.ok).toBe(true);
    const again = persistRoadmap({
      workspaceRoot: ws,
      content: DRAFT,
      filePath: path.join(ws, first.path!),
    });
    expect(again.ok).toBe(true);
    expect(fs.readFileSync(path.join(ws, again.path!), "utf8")).toMatch(
      /^status: locked$/m,
    );
    const moved = persistRoadmap({
      workspaceRoot: ws,
      content: DRAFT.replace(
        "ROADMAP_NAME: auth program\n",
        "status: in-progress\nROADMAP_NAME: auth program\n",
      ),
      filePath: path.join(ws, first.path!),
    });
    expect(moved.ok).toBe(true);
    expect(fs.readFileSync(path.join(ws, moved.path!), "utf8")).toMatch(
      /^status: in-progress$/m,
    );
  });

  it("rejects a locked roadmap whose slice has no Why", () => {
    const ws = tmpWs();
    const locked = DRAFT.replace(
      "      Why: Later slices add skills. This slot keeps init and INDEX together.\n",
      "",
    ).replace("ROADMAP_NAME: auth program\n", "status: locked\nROADMAP_NAME: auth program\n");
    const r = persistRoadmap({ workspaceRoot: ws, content: locked });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("why");
  });
});
