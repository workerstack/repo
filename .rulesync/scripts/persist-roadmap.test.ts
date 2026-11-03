import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runPersistCli } from "./fixtures/run-persist-cli.mjs";
import { DRAFT_ROADMAP } from "./fixtures/persist-bodies.mjs";
import { persistRoadmap, prepareRoadmapUpdate } from "./persist-roadmap.mjs";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

// The host side of a roadmap rewrite: validate through prepareRoadmapUpdate, then write what it returns.
function update(ws: string, abs: string, content: string) {
  const r = prepareRoadmapUpdate({ workspaceRoot: ws, filePath: abs, content });
  if (r.ok) fs.writeFileSync(abs, r.content!);
  return r;
}

function tmpWs() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "persist-roadmap-"));
  tmpDirs.push(dir);
  return dir;
}

describe("persistRoadmap", () => {
  it("persists a two-slice draft with no Location at serial 1", () => {
    const ws = tmpWs();
    const created = "2026-10-25T18:00:00Z";
    const r = persistRoadmap({ workspaceRoot: ws, content: DRAFT_ROADMAP, created });
    expect(r.ok).toBe(true);
    expect(r.serial).toBe(1);
    expect(r.path).toBe(".tmp/grunt/roadmaps/1-auth-program-20261025T180000Z.md");
    const text = fs.readFileSync(path.join(ws, r.path!), "utf8");
    expect(text).toMatch(/^status: draft$/m);
    expect(text).not.toMatch(/^\s+Location:/m);
    expect(text).toMatch(/Title: auth types/);
    expect(text).toMatch(/Title: commit diff pass/);
    expect(fs.readFileSync(path.join(ws, ".gitignore"), "utf8")).toMatch(/^\.tmp\/$/m);
  });

  it("rejects a one-slice roadmap", () => {
    const ws = tmpWs();
    const one = DRAFT_ROADMAP.replace(
      /2 \[ \] Title: commit diff pass\n      Goal: Commit skills strip narrating comments\.\n      Why: Every later land goes through commit\.\n/,
      "",
    );
    const r = persistRoadmap({ workspaceRoot: ws, content: one });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("slices");
    expect(fs.existsSync(path.join(ws, ".tmp/grunt/roadmaps"))).toBe(true);
    expect(fs.readdirSync(path.join(ws, ".tmp/grunt/roadmaps"))).toEqual([]);
  });

  it("rejects a Goal that is not 1 to 3 sentences", () => {
    const ws = tmpWs();
    const bad = DRAFT_ROADMAP.replace(
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
    const first = persistRoadmap({ workspaceRoot: ws, content: DRAFT_ROADMAP, created });
    expect(first.ok).toBe(true);
    const again = update(
      ws,
      path.join(ws, first.path!),
      String(first.content).replace("This slot keeps init and INDEX together.", "This slot keeps init and INDEX aligned."),
    );
    expect(again.ok).toBe(true);
    expect(again.serial).toBe(1);
    expect(again.path).toBe(first.path);
    expect(fs.readdirSync(path.join(ws, ".tmp/grunt/roadmaps"))).toEqual([
      "1-auth-program-20261025T180000Z.md",
    ]);
    expect(fs.readFileSync(path.join(ws, again.path!), "utf8")).toMatch(
      /INDEX aligned/,
    );
  });

  it("validates a rewrite of a saved roadmap without writing it", () => {
    const ws = tmpWs();
    const first = persistRoadmap({ workspaceRoot: ws, content: DRAFT_ROADMAP, created: "2026-10-25T18:00:00Z" });
    const abs = path.join(ws, first.path!);
    const before = fs.readFileSync(abs, "utf8");
    const r = prepareRoadmapUpdate({
      workspaceRoot: ws,
      filePath: abs,
      content: DRAFT_ROADMAP.replace("Every later land goes through commit.", "Every later land goes through the commit skill."),
    });
    expect(r.ok, r.error).toBe(true);
    expect(r.serial).toBe(1);
    expect(r.path).toBe(first.path);
    expect(r.content).toMatch(/^serial: 1$/m);
    expect(r.content).toMatch(/through the commit skill\./);
    // The host writes it: a hook write first makes Claude Code refuse the Write as modified since read.
    expect(fs.readFileSync(abs, "utf8")).toBe(before);
    const bad = prepareRoadmapUpdate({ workspaceRoot: ws, filePath: abs, content: DRAFT_ROADMAP.replace("## Goal", "## Aim") });
    expect(bad.ok).toBe(false);
  });

  it("rejects a Location outside the plans dir", () => {
    const ws = tmpWs();
    const rel = DRAFT_ROADMAP.replace(
      "1 [ ] Title: auth types\n",
      "1 [ ] Title: auth types\n      Location: .tmp/grunt/roadmaps/nope.md\n",
    );
    const r = persistRoadmap({ workspaceRoot: ws, content: rel });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("location");
  });

  it("accepts a workspace-relative plan Location", () => {
    const ws = tmpWs();
    const rel = DRAFT_ROADMAP.replace(
      "1 [ ] Title: auth types\n",
      "1 [ ] Title: auth types\n      Location: .tmp/grunt/plans/14-auth-types-20261025T165531Z.md\n",
    );
    const r = persistRoadmap({ workspaceRoot: ws, content: rel });
    expect(r.ok).toBe(true);
  });

  it("rejects a fresh create that is locked or already checked", () => {
    const ws = tmpWs();
    const locked = DRAFT_ROADMAP.replace(
      "ROADMAP_NAME: auth program\n",
      "status: locked\nROADMAP_NAME: auth program\n",
    );
    const lockedResult = persistRoadmap({ workspaceRoot: ws, content: locked });
    expect(lockedResult.ok).toBe(false);
    expect(lockedResult.errors).toContain("fresh status");
    const checked = DRAFT_ROADMAP.replace("1 [ ] Title: auth types", "1 [x] Title: auth types");
    const checkedResult = persistRoadmap({ workspaceRoot: ws, content: checked });
    expect(checkedResult.ok).toBe(false);
    expect(checkedResult.errors).toContain("fresh [x]");
  });

  it("keeps a locked status when the next full write omits status", () => {
    const ws = tmpWs();
    const created = "2026-10-25T18:00:00Z";
    const first = persistRoadmap({ workspaceRoot: ws, content: DRAFT_ROADMAP, created });
    expect(first.ok).toBe(true);
    const abs = path.join(ws, first.path!);
    const locked = update(
      ws,
      abs,
      DRAFT_ROADMAP.replace("ROADMAP_NAME: auth program\n", "status: locked\nreviews: 1\nROADMAP_NAME: auth program\n"),
    );
    expect(locked.ok).toBe(true);
    const again = update(ws, abs, DRAFT_ROADMAP);
    expect(again.ok).toBe(true);
    expect(fs.readFileSync(path.join(ws, again.path!), "utf8")).toMatch(
      /^status: locked$/m,
    );
    const moved = update(
      ws,
      abs,
      DRAFT_ROADMAP.replace("ROADMAP_NAME: auth program\n", "status: in-progress\nROADMAP_NAME: auth program\n"),
    );
    expect(moved.ok).toBe(true);
    expect(fs.readFileSync(path.join(ws, moved.path!), "utf8")).toMatch(
      /^status: in-progress$/m,
    );
  });

  it("rejects a locked roadmap whose slice has no Why", () => {
    const ws = tmpWs();
    const locked = DRAFT_ROADMAP.replace(
      "      Why: Later slices add skills. This slot keeps init and INDEX together.\n",
      "",
    ).replace("ROADMAP_NAME: auth program\n", "status: locked\nROADMAP_NAME: auth program\n");
    const r = persistRoadmap({ workspaceRoot: ws, content: locked });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("why");
  });
});

describe("roadmap Previous mistakes and reviews", () => {
  const created = "2026-10-25T18:00:00Z";
  const entry = "- slice: plan 22 found lifecycle hooks must be async → D2 now says async and slice 3 waits on it";

  function saved(ws: string, content = DRAFT_ROADMAP) {
    const r = persistRoadmap({ workspaceRoot: ws, content, created });
    expect(r.ok, r.error).toBe(true);
    return path.join(ws, r.path!);
  }

  function withEntries(text: string, ...entries: string[]) {
    return text.replace(/## Previous mistakes\n[\s\S]*$/, `## Previous mistakes\n${entries.join("\n")}\n`);
  }

  const lockLine = (n: number) => `status: locked\nreviews: ${n}\nROADMAP_NAME: auth program\n`;

  it("requires the section on a new roadmap and starts the review count at 0", () => {
    const ws = tmpWs();
    const bare = DRAFT_ROADMAP.replace("\n## Previous mistakes\n(none)\n", "");
    const r = persistRoadmap({ workspaceRoot: ws, content: bare });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/missing ## Previous mistakes; end a new roadmap with it and \(none\)/);
    expect(fs.readFileSync(saved(ws), "utf8")).toMatch(/^reviews: 0$/m);
  });

  it("accepts a slice entry and keeps every saved entry", () => {
    const ws = tmpWs();
    const abs = saved(ws, withEntries(DRAFT_ROADMAP, entry));
    const second = "- review: slice 2 had no runnable gate → Verify 3.1 runs the suite";
    expect(update(ws, abs, withEntries(DRAFT_ROADMAP, entry, second)).ok).toBe(true);
    const changed = update(ws, abs, withEntries(DRAFT_ROADMAP, entry.replace("async", "sync"), second));
    expect(changed.ok).toBe(false);
    expect(changed.error).toContain(`keep this entry unchanged: ${entry}`);
    expect(update(ws, abs, withEntries(DRAFT_ROADMAP, second)).ok).toBe(false);
  });

  it("rejects an unknown entry kind and a section that is not last", () => {
    const ws = tmpWs();
    const bad = persistRoadmap({ workspaceRoot: ws, content: withEntries(DRAFT_ROADMAP, "- oops: a → b") });
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/feedback\|verify\|review\|premise\|slice/);
    const moved = DRAFT_ROADMAP.replace("\n## Previous mistakes\n(none)\n", "").replace(
      "## Watch-outs",
      "## Previous mistakes\n(none)\n\n## Watch-outs",
    );
    expect(persistRoadmap({ workspaceRoot: ws, content: moved }).error).toMatch(/must be the last heading/);
  });

  it("keeps a roadmap saved before the section and the count editable", () => {
    const ws = tmpWs();
    const dir = path.join(ws, ".tmp/grunt/roadmaps");
    fs.mkdirSync(dir, { recursive: true });
    const abs = path.join(dir, "1-auth-program-20261025T180000Z.md");
    const legacy = DRAFT_ROADMAP.replace("\n## Previous mistakes\n(none)\n", "");
    fs.writeFileSync(
      abs,
      `---\nserial: 1\nname: auth-program\nstatus: locked\ncreated: ${created}\nsource: "auth program"\n---\n\n${legacy.replace("ROADMAP_NAME: auth program\n\n", "")}`,
    );
    const r = update(ws, abs, legacy.replace("1 [ ] Title", "1 [x] Title"));
    expect(r.ok, r.error).toBe(true);
    expect(fs.readFileSync(abs, "utf8")).toMatch(/^status: locked$/m);
  });

  it("locks only after a settled review round", () => {
    const ws = tmpWs();
    const abs = saved(ws);
    const denied = update(ws, abs, DRAFT_ROADMAP.replace("ROADMAP_NAME: auth program\n", "status: locked\nROADMAP_NAME: auth program\n"));
    expect(denied.ok).toBe(false);
    expect(denied.error).toMatch(/status locked needs reviews: 1 or more; run \/review-roadmap \{n\}/);
    const r = update(ws, abs, DRAFT_ROADMAP.replace("ROADMAP_NAME: auth program\n", lockLine(1)));
    expect(r.ok, r.error).toBe(true);
    expect(fs.readFileSync(abs, "utf8")).toMatch(/^reviews: 1$/m);
  });

  it("keeps the saved count on a body-only save and never lowers or drops it", () => {
    const ws = tmpWs();
    const abs = saved(ws);
    expect(update(ws, abs, DRAFT_ROADMAP.replace("ROADMAP_NAME: auth program\n", "reviews: 2\nROADMAP_NAME: auth program\n")).ok).toBe(true);
    expect(update(ws, abs, DRAFT_ROADMAP).ok).toBe(true);
    expect(fs.readFileSync(abs, "utf8")).toMatch(/^reviews: 2$/m);
    const lowered = update(ws, abs, DRAFT_ROADMAP.replace("ROADMAP_NAME: auth program\n", "reviews: 1\nROADMAP_NAME: auth program\n"));
    expect(lowered.error).toMatch(/reviews cannot go down \(saved 2, got 1\)/);
    const full = fs.readFileSync(abs, "utf8").replace("reviews: 2\n", "");
    expect(update(ws, abs, full).error).toMatch(/keep reviews: 2/);
  });
});

describe("persist-roadmap CLI", () => {
  it("prints the absolute path of the saved file for a relative --workspace", () => {
    const r = runPersistCli("persist-roadmap.mjs", DRAFT_ROADMAP);
    tmpDirs.push(r.cwd);
    expect(r.status, r.stderr).toBe(0);
    expect(r.json.absPath).toBe(path.join(r.ws, r.json.path));
    expect(fs.existsSync(r.json.absPath)).toBe(true);
  });
});

describe("roadmap usage section", () => {
  const noUsage = DRAFT_ROADMAP.replace(/## Usage\n[\s\S]*?(?=## Context)/, "");
  const withUsage = noUsage.replace("## Context", "## Usage\nNo visible change: internal\n\n## Context");

  it("denies a fresh roadmap without Usage and saves one with it", () => {
    const r = persistRoadmap({ workspaceRoot: tmpWs(), content: noUsage });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("missing ## Usage after ## Goal");
    expect(persistRoadmap({ workspaceRoot: tmpWs(), content: withUsage }).ok).toBe(true);
  });

  it("lets an update without Usage pass and denies Usage after Context", () => {
    const ws = tmpWs();
    const r = persistRoadmap({ workspaceRoot: ws, content: withUsage });
    expect(r.ok, r.error).toBe(true);
    const abs = path.join(ws, r.path!);
    const legacy = fs.readFileSync(abs, "utf8").replace(/## Usage\n[\s\S]*?(?=## Context)/, "");
    fs.writeFileSync(abs, legacy);
    expect(update(ws, abs, legacy.replace("Names stay reserved.", "Names stay put.")).ok).toBe(true);
    const moved = legacy.replace("## Decisions", "## Usage\nNo visible change: x\n\n## Decisions");
    const bad = prepareRoadmapUpdate({ workspaceRoot: ws, filePath: abs, content: moved });
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain("## Usage must come right after ## Goal");
  });
});
