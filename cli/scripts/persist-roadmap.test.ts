import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DRAFT_ROADMAP, LEGACY_ROADMAP } from "./fixtures/persist-bodies.ts";
import { locationOk, persistRoadmap, prepareRoadmapUpdate } from "./persist-roadmap.ts";

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

const LEGACY_FILE = "1-auth-program-20261025T180000Z.md";
// The deny a fresh roadmap gets for a section that belongs in the slice plans.
const extra = (h: string) =>
  `a new roadmap has only ## Order, ## Verify and ## Previous mistakes; move ## ${h} into the slice plans`;

// A roadmap saved in the old shape before pointer roadmaps: written straight to disk, as roadmaps 1–4 are.
function savedLegacy(ws: string, body = LEGACY_ROADMAP, head = "status: draft\nreviews: 0") {
  const dir = path.join(ws, ".tmp/repo/roadmaps");
  fs.mkdirSync(dir, { recursive: true });
  const abs = path.join(dir, LEGACY_FILE);
  const rest = body.replace(/^ROADMAP_NAME:.*\n/, "").replace(/^strategy:.*\n\n?/, "");
  fs.writeFileSync(
    abs,
    `---\nserial: 1\nname: auth-program\n${head}\ncreated: 2026-10-25T18:00:00Z\nsource: "auth program"\nstrategy: default\n---\n\n${rest}`,
  );
  return abs;
}

describe("persistRoadmap", () => {
  it("persists a two-slice pointer draft with no Location at serial 1", () => {
    const ws = tmpWs();
    const created = "2026-10-25T18:00:00Z";
    const r = persistRoadmap({ workspaceRoot: ws, content: DRAFT_ROADMAP, created });
    expect(r.ok).toBe(true);
    expect(r.serial).toBe(1);
    expect(r.path).toBe(".tmp/repo/roadmaps/1-auth-program-20261025T180000Z.md");
    const text = fs.readFileSync(path.join(ws, r.path!), "utf8");
    expect(text).toMatch(/^status: draft$/m);
    expect(text).not.toMatch(/^\s+Location:/m);
    expect(text).toMatch(/^1 \[ \] auth types: Reserved names list the new skills\.$/m);
    expect(text).toMatch(/^2 \[ \] commit diff pass: Commit skills strip narrating comments\.$/m);
  });

  it("never touches .gitignore", () => {
    const ws = tmpWs();
    persistRoadmap({ workspaceRoot: ws, content: DRAFT_ROADMAP });
    expect(fs.existsSync(path.join(ws, ".gitignore"))).toBe(false);
    const kept = tmpWs();
    fs.writeFileSync(path.join(kept, ".gitignore"), "node_modules\n");
    persistRoadmap({ workspaceRoot: kept, content: DRAFT_ROADMAP });
    persistRoadmap({ workspaceRoot: kept, content: DRAFT_ROADMAP });
    expect(fs.readFileSync(path.join(kept, ".gitignore"), "utf8")).toBe("node_modules\n");
  });

  it("rejects a one-slice roadmap", () => {
    const ws = tmpWs();
    const one = DRAFT_ROADMAP.replace("2 [ ] commit diff pass: Commit skills strip narrating comments.\n", "");
    const r = persistRoadmap({ workspaceRoot: ws, content: one });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("slices");
    expect(fs.existsSync(path.join(ws, ".tmp/repo/roadmaps"))).toBe(true);
    expect(fs.readdirSync(path.join(ws, ".tmp/repo/roadmaps"))).toEqual([]);
  });

  it("rejects a legacy update whose Goal is not 1 to 3 sentences", () => {
    const ws = tmpWs();
    const abs = savedLegacy(ws);
    const bad = LEGACY_ROADMAP.replace(
      "## Goal\nShip auth as two plans. The second plan waits on the first. Names stay reserved.\n",
      "## Goal\nOne. Two. Three. Four.\n",
    );
    const r = prepareRoadmapUpdate({ workspaceRoot: ws, filePath: abs, content: bad });
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
      String(first.content).replace("strip narrating comments.", "strip narrating comments and logs."),
    );
    expect(again.ok).toBe(true);
    expect(again.serial).toBe(1);
    expect(again.path).toBe(first.path);
    expect(fs.readdirSync(path.join(ws, ".tmp/repo/roadmaps"))).toEqual(["1-auth-program-20261025T180000Z.md"]);
    expect(fs.readFileSync(path.join(ws, again.path!), "utf8")).toMatch(/comments and logs\./);
  });

  it("validates a rewrite of a saved roadmap without writing it", () => {
    const ws = tmpWs();
    const first = persistRoadmap({ workspaceRoot: ws, content: DRAFT_ROADMAP, created: "2026-10-25T18:00:00Z" });
    const abs = path.join(ws, first.path!);
    const before = fs.readFileSync(abs, "utf8");
    const r = prepareRoadmapUpdate({
      workspaceRoot: ws,
      filePath: abs,
      content: DRAFT_ROADMAP.replace("strip narrating comments.", "strip narrating comments and logs."),
    });
    expect(r.ok, r.error).toBe(true);
    expect(r.serial).toBe(1);
    expect(r.path).toBe(first.path);
    expect(r.content).toMatch(/^serial: 1$/m);
    expect(r.content).toMatch(/comments and logs\./);
    // The host writes it: a hook write first makes Claude Code refuse the Write as modified since read.
    expect(fs.readFileSync(abs, "utf8")).toBe(before);
    const bad = prepareRoadmapUpdate({
      workspaceRoot: ws,
      filePath: abs,
      content: DRAFT_ROADMAP.replace("## Order", "## Aim"),
    });
    expect(bad.ok).toBe(false);
  });

  it("rejects a Location outside the plans dir", () => {
    const ws = tmpWs();
    const rel = DRAFT_ROADMAP.replace(
      "1 [ ] auth types: Reserved names list the new skills.\n",
      "1 [ ] auth types: Reserved names list the new skills.\n      Location: .tmp/repo/roadmaps/nope.md\n",
    );
    const r = persistRoadmap({ workspaceRoot: ws, content: rel });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("location");
  });

  it("accepts a workspace-relative plan Location", () => {
    const ws = tmpWs();
    const rel = DRAFT_ROADMAP.replace(
      "1 [ ] auth types: Reserved names list the new skills.\n",
      "1 [ ] auth types: Reserved names list the new skills.\n      Location: .tmp/repo/plans/14-auth-types-20261025T165531Z.md\n",
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
    const checked = DRAFT_ROADMAP.replace("1 [ ] auth types", "1 [x] auth types");
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
    expect(fs.readFileSync(path.join(ws, again.path!), "utf8")).toMatch(/^status: locked$/m);
    const moved = update(
      ws,
      abs,
      DRAFT_ROADMAP.replace("ROADMAP_NAME: auth program\n", "status: in-progress\nROADMAP_NAME: auth program\n"),
    );
    expect(moved.ok).toBe(true);
    expect(fs.readFileSync(path.join(ws, moved.path!), "utf8")).toMatch(/^status: in-progress$/m);
  });

  it("rejects a legacy update whose slice has no Why", () => {
    const ws = tmpWs();
    const abs = savedLegacy(ws);
    const noWhy = LEGACY_ROADMAP.replace(
      "      Why: Later slices add skills. This slot keeps init and INDEX together.\n",
      "",
    );
    const r = prepareRoadmapUpdate({ workspaceRoot: ws, filePath: abs, content: noWhy });
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
    expect(bad.error).toMatch(/feedback\|verify\|review\|premise\|decision\|slice/);
    const moved = DRAFT_ROADMAP.replace("\n## Previous mistakes\n(none)\n", "").replace(
      "## Verify",
      "## Previous mistakes\n(none)\n\n## Verify",
    );
    expect(persistRoadmap({ workspaceRoot: ws, content: moved }).error).toMatch(/must be the last heading/);
  });

  it("keeps a roadmap saved before the section and the count editable", () => {
    const ws = tmpWs();
    const legacy = LEGACY_ROADMAP.replace("\n## Previous mistakes\n(none)\n", "");
    const abs = savedLegacy(ws, legacy, "status: locked");
    const r = update(ws, abs, legacy.replace("1 [ ] Title", "1 [x] Title"));
    expect(r.ok, r.error).toBe(true);
    expect(fs.readFileSync(abs, "utf8")).toMatch(/^status: locked$/m);
  });

  it("locks only after a settled review round", () => {
    const ws = tmpWs();
    const abs = saved(ws);
    const denied = update(
      ws,
      abs,
      DRAFT_ROADMAP.replace("ROADMAP_NAME: auth program\n", "status: locked\nROADMAP_NAME: auth program\n"),
    );
    expect(denied.ok).toBe(false);
    expect(denied.error).toMatch(/status locked needs reviews: 1 or more; run \/review-roadmap \{n\}/);
    const r = update(ws, abs, DRAFT_ROADMAP.replace("ROADMAP_NAME: auth program\n", lockLine(1)));
    expect(r.ok, r.error).toBe(true);
    expect(fs.readFileSync(abs, "utf8")).toMatch(/^reviews: 1$/m);
  });

  it("keeps the saved count on a body-only save and never lowers or drops it", () => {
    const ws = tmpWs();
    const abs = saved(ws);
    expect(
      update(ws, abs, DRAFT_ROADMAP.replace("ROADMAP_NAME: auth program\n", "reviews: 2\nROADMAP_NAME: auth program\n"))
        .ok,
    ).toBe(true);
    expect(update(ws, abs, DRAFT_ROADMAP).ok).toBe(true);
    expect(fs.readFileSync(abs, "utf8")).toMatch(/^reviews: 2$/m);
    const lowered = update(
      ws,
      abs,
      DRAFT_ROADMAP.replace("ROADMAP_NAME: auth program\n", "reviews: 1\nROADMAP_NAME: auth program\n"),
    );
    expect(lowered.error).toMatch(/reviews cannot go down \(saved 2, got 1\)/);
    const full = fs.readFileSync(abs, "utf8").replace("reviews: 2\n", "");
    expect(update(ws, abs, full).error).toMatch(/keep reviews: 2/);
  });
});

describe("legacy roadmap usage section", () => {
  it("lets an update of a roadmap saved without Usage pass and denies Usage after Context", () => {
    const ws = tmpWs();
    const noUsage = LEGACY_ROADMAP.replace(/## Usage\n[\s\S]*?(?=## Context)/, "");
    const abs = savedLegacy(ws, noUsage);
    expect(update(ws, abs, noUsage.replace("Names stay reserved.", "Names stay put.")).ok).toBe(true);
    const moved = noUsage.replace("## Decisions", "## Usage\nNo visible change: x\n\n## Decisions");
    const bad = prepareRoadmapUpdate({ workspaceRoot: ws, filePath: abs, content: moved });
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain("## Usage must come right after ## Goal");
  });
});

describe("roadmap strategy", () => {
  const created = "2026-10-25T18:00:00Z";
  const NO_KEY = "strategy: default|review-fast|review-deep";
  const without = (body: string) => body.replace(/^strategy:.*\n/m, "");
  const withStrategy = (body: string, value: string) => body.replace(/^strategy:.*$/m, `strategy: ${value}`);
  const read = (p: string) => fs.readFileSync(p, "utf8");

  it("moves a body strategy line into the frontmatter after source and out of the body", () => {
    const ws = tmpWs();
    const r = persistRoadmap({ workspaceRoot: ws, content: withStrategy(DRAFT_ROADMAP, "review-deep"), created });
    expect(r.ok, r.error).toBe(true);
    const [head, ...body] = read(path.join(ws, r.path!)).split("\n---\n");
    expect(head).toMatch(/\nsource: "auth program"\nstrategy: review-deep$/);
    expect(body.join("\n---\n")).not.toMatch(/^strategy:/m);
  });

  it("denies a save without it and an unknown value", () => {
    const ws = tmpWs();
    const missing = persistRoadmap({ workspaceRoot: ws, content: without(DRAFT_ROADMAP), created });
    expect(missing.ok).toBe(false);
    expect(missing.errors).toContain(NO_KEY);
    const unknown = persistRoadmap({
      workspaceRoot: ws,
      content: withStrategy(DRAFT_ROADMAP, "review-medium"),
      created,
    });
    expect(unknown.ok).toBe(false);
    expect(unknown.errors).toContain(NO_KEY);
    expect(fs.readdirSync(path.join(ws, ".tmp/repo/roadmaps"))).toEqual([]);
  });

  it("keeps the key on a body-only update, takes a new one, and denies a frontmatter without it", () => {
    const ws = tmpWs();
    const first = persistRoadmap({ workspaceRoot: ws, content: withStrategy(DRAFT_ROADMAP, "review-fast"), created });
    const abs = path.join(ws, first.path!);
    const kept = update(
      ws,
      abs,
      without(DRAFT_ROADMAP).replace("strip narrating comments.", "strip narrating comments and logs."),
    );
    expect(kept.ok, kept.error).toBe(true);
    expect(read(abs)).toMatch(/^strategy: review-fast$/m);
    const changed = update(ws, abs, withStrategy(DRAFT_ROADMAP, "default"));
    expect(changed.ok, changed.error).toBe(true);
    expect(read(abs)).toMatch(/^strategy: default$/m);
    expect(read(abs).match(/^strategy:/gm)).toHaveLength(1);
    const full = update(ws, abs, read(abs).replace(/^strategy:.*\n/m, ""));
    expect(full.ok).toBe(false);
    expect(full.errors).toContain(NO_KEY);
  });
});

describe("roadmap mode", () => {
  const created = "2026-10-25T18:00:00Z";
  const MODE_KEY = "mode: ask|auto|away";
  const withMode = (body: string, value: string) => body.replace(/^strategy:.*$/m, (l) => `${l}\nmode: ${value}`);
  const read = (p: string) => fs.readFileSync(p, "utf8");

  it("moves a body mode line into the frontmatter right after strategy and out of the body", () => {
    const ws = tmpWs();
    const r = persistRoadmap({ workspaceRoot: ws, content: withMode(DRAFT_ROADMAP, "away"), created });
    expect(r.ok, r.error).toBe(true);
    const [head, ...body] = read(path.join(ws, r.path!)).split("\n---\n");
    expect(head).toMatch(/\nstrategy: default\nmode: away$/);
    expect(body.join("\n---\n")).not.toMatch(/^mode:/m);
  });

  it("denies an unknown mode on a body line or in the frontmatter", () => {
    const ws = tmpWs();
    const bad = persistRoadmap({ workspaceRoot: ws, content: withMode(DRAFT_ROADMAP, "later"), created });
    expect(bad.ok).toBe(false);
    expect(bad.errors).toContain(MODE_KEY);
    expect(fs.readdirSync(path.join(ws, ".tmp/repo/roadmaps"))).toEqual([]);
    const ok = persistRoadmap({ workspaceRoot: ws, content: DRAFT_ROADMAP, created });
    expect(ok.ok, ok.error).toBe(true);
    const abs = path.join(ws, ok.path!);
    expect(read(abs)).not.toMatch(/^mode:/m);
    const full = update(ws, abs, withMode(read(abs), "later"));
    expect(full.ok).toBe(false);
    expect(full.errors).toContain(MODE_KEY);
  });

  it("keeps a saved mode on a body-only update and takes a new one", () => {
    const ws = tmpWs();
    const r = persistRoadmap({ workspaceRoot: ws, content: withMode(DRAFT_ROADMAP, "auto"), created });
    expect(r.ok, r.error).toBe(true);
    const abs = path.join(ws, r.path!);
    const kept = update(ws, abs, DRAFT_ROADMAP.replace(/^strategy:.*\n/m, ""));
    expect(kept.ok, kept.error).toBe(true);
    expect(read(abs)).toMatch(/^mode: auto$/m);
    const changed = update(ws, abs, withMode(DRAFT_ROADMAP, "ask"));
    expect(changed.ok, changed.error).toBe(true);
    expect(read(abs).match(/^mode:/gm)).toEqual(["mode:"]);
    expect(read(abs)).toMatch(/^mode: ask$/m);
  });

  it("saves a decision entry and denies an update that edits or drops it", () => {
    const ws = tmpWs();
    const entry = "- decision: a → b because c";
    const withEntries = (text: string, ...entries: string[]) =>
      text.replace(/## Previous mistakes\n[\s\S]*$/, `## Previous mistakes\n${entries.join("\n")}\n`);
    const r = persistRoadmap({ workspaceRoot: ws, content: withEntries(DRAFT_ROADMAP, entry), created });
    expect(r.ok, r.error).toBe(true);
    const abs = path.join(ws, r.path!);
    for (const content of [
      withEntries(DRAFT_ROADMAP, "(none)"),
      withEntries(DRAFT_ROADMAP, entry.replace("because c", "because d")),
    ]) {
      const u = update(ws, abs, content);
      expect(u.ok).toBe(false);
      expect(u.error).toContain(`keep this entry unchanged: ${entry}`);
    }
  });
});

describe("pointer roadmap", () => {
  const created = "2026-11-09T10:15:00Z";
  const save = (content: string, ws = tmpWs()) => persistRoadmap({ workspaceRoot: ws, content, created });
  const SLICE_RULE = (n: number) => `slice ${n} needs "N [ ] {title, 2–6 words}: {one sentence}"`;
  const CAP = (n: number) => `${n} lines above ## Previous mistakes, the cap is 60; move detail into the slice plans`;
  const SLICE_1 = "1 [ ] auth types: Reserved names list the new skills.\n";
  const SLICE_2 = "2 [ ] commit diff pass: Commit skills strip narrating comments.\n";
  const WIN_LOCATION = "C:\\Users\\me\\app\\.tmp\\repo\\plans\\21-json-export-20261109T101500Z.md";

  // The draft with n one-line slices; `location` adds an indented Location line under each.
  function withSlices(n: number, location?: (i: number) => string) {
    const lines = Array.from({ length: n }, (_, i) => {
      const line = `${i + 1} [ ] slice number ${i + 1}: Slice ${i + 1} ships one change.`;
      return location ? `${line}\n      Location: ${location(i + 1)}` : line;
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
    return 2 + lines - above(base.content!);
  }

  it("saves a fresh pointer roadmap with no Goal, Usage or Decisions", () => {
    const r = save(DRAFT_ROADMAP);
    expect(r.ok, r.error).toBe(true);
    expect(r.content).not.toMatch(/^## (Goal|Usage|Context|Decisions|Watch-outs)$/m);
  });

  it.each(["Goal", "Usage", "Context", "Decisions", "Watch-outs"])("denies a fresh roadmap with ## %s", (h) => {
    const ws = tmpWs();
    const r = save(DRAFT_ROADMAP.replace("## Order", `## ${h}\n- one line about ${h}.\n\n## Order`), ws);
    expect(r.ok).toBe(false);
    expect(r.errors).toContain(extra(h));
    expect(fs.readdirSync(path.join(ws, ".tmp/repo/roadmaps"))).toEqual([]);
  });

  it("denies a fresh roadmap without the card", () => {
    const r = save(DRAFT_ROADMAP.replace(/WHAT[\s\S]*?DONE.*\n\n/, ""));
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("start with the 5-line card after the title: WHAT, WHY, RISK, TOUCH, DONE");
  });

  it.each([
    [
      "an old two-line slice",
      1,
      SLICE_1,
      "1 [ ] Title: auth types\n      Goal: Reserved names list the new skills.\n      Why: Later slices add skills.\n",
    ],
    ["a 1-word title", 2, SLICE_2, "2 [ ] commit: Commit skills strip narrating comments.\n"],
    [
      "a 7-word title",
      2,
      SLICE_2,
      "2 [ ] commit diff pass for every skill file: Commit skills strip narrating comments.\n",
    ],
    ["two sentences", 2, SLICE_2, "2 [ ] commit diff pass: Commit skills strip narrating comments. They also lint.\n"],
    ["no sentence", 2, SLICE_2, "2 [ ] commit diff pass\n"],
  ])("denies a fresh roadmap with %s", (_, n, from, to) => {
    const r = save(DRAFT_ROADMAP.replace(from, to));
    expect(r.ok).toBe(false);
    expect(r.errors).toContain(SLICE_RULE(n));
  });

  it("saves 60 lines above Previous mistakes and denies 61", () => {
    const n = slicesFor(60);
    const at = save(withSlices(n));
    expect(at.ok, at.error).toBe(true);
    expect(above(at.content!)).toBe(60);
    const ws = tmpWs();
    const over = save(withSlices(n + 1), ws);
    expect(over.ok).toBe(false);
    expect(over.errors).toContain(CAP(61));
    expect(fs.readdirSync(path.join(ws, ".tmp/repo/roadmaps"))).toEqual([]);
  });

  it("does not count Location lines toward the cap", () => {
    const ws = tmpWs();
    const n = slicesFor(60);
    const plan = (i: number) => path.join(ws, ".tmp/repo/plans", `${i}-slice-number-${i}-20261109T101500Z.md`);
    const r = save(withSlices(n, plan), ws);
    expect(r.ok, r.error).toBe(true);
    expect(r.content!.split("\n").indexOf("## Previous mistakes")).toBe(60 + n);
  });

  it("saves a slice whose Location is a Windows plan path", () => {
    const r = save(DRAFT_ROADMAP.replace(SLICE_1, `${SLICE_1}      Location: ${WIN_LOCATION}\n`));
    expect(r.ok, r.error).toBe(true);
  });

  it("accepts a Windows plan Location under win32 and posix path rules, and not a roadmap path", () => {
    for (const p of [path.win32, path.posix]) {
      expect(locationOk(WIN_LOCATION, p), p === path.win32 ? "win32" : "posix").toBe(true);
      expect(locationOk(".tmp\\repo\\roadmaps\\nope.md", p)).toBe(false);
    }
  });

  it("denies a pointer update that grows past 60 lines and allows one that adds a Location line", () => {
    const ws = tmpWs();
    const n = slicesFor(60);
    const first = save(withSlices(n), ws);
    expect(first.ok, first.error).toBe(true);
    const abs = path.join(ws, first.path!);
    const grown = prepareRoadmapUpdate({ workspaceRoot: ws, filePath: abs, content: withSlices(n + 1) });
    expect(grown.ok).toBe(false);
    expect(grown.errors).toContain(CAP(61));
    const located = withSlices(n).replace(
      "1 [ ] slice number 1: Slice 1 ships one change.\n",
      `1 [ ] slice number 1: Slice 1 ships one change.\n      Location: ${path.join(ws, ".tmp/repo/plans/9-slice-number-1-20261109T101500Z.md")}\n`,
    );
    const r = update(ws, abs, located.replace("1 [ ] slice number 1", "1 [x] slice number 1"));
    expect(r.ok, r.error).toBe(true);
  });

  it("denies a pointer update that adds ## Decisions", () => {
    const ws = tmpWs();
    const first = save(DRAFT_ROADMAP, ws);
    expect(first.ok, first.error).toBe(true);
    const abs = path.join(ws, first.path!);
    const r = prepareRoadmapUpdate({
      workspaceRoot: ws,
      filePath: abs,
      content: DRAFT_ROADMAP.replace("## Order", "## Decisions\n- D1. Fetch stays upstream.\n\n## Order"),
    });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain(extra("Decisions"));
  });
});

describe("legacy roadmap update", () => {
  // Pads Context with bullets so the saved legacy roadmap runs past the pointer cap, like roadmap 4.
  const long = LEGACY_ROADMAP.replace(
    "## Context\n",
    `## Context\n${Array.from({ length: 40 }, (_, i) => `- context fact ${i + 1}`).join("\n")}\n`,
  );

  it("still saves an old-shape roadmap past 60 lines under the old rules", () => {
    const ws = tmpWs();
    const abs = savedLegacy(ws, long);
    expect(fs.readFileSync(abs, "utf8").split("\n").indexOf("## Previous mistakes")).toBeGreaterThan(60);
    const r = update(ws, abs, long.replace("1 [ ] Title: auth types", "1 [x] Title: auth types"));
    expect(r.ok, r.error).toBe(true);
    expect(fs.readFileSync(abs, "utf8")).toMatch(/^1 \[x\] Title: auth types$/m);
  });

  it("holds an old-shape update that deletes ## Goal to the old rules", () => {
    const ws = tmpWs();
    const abs = savedLegacy(ws, long);
    const before = fs.readFileSync(abs, "utf8");
    const noGoal = long.replace(/## Goal\n[\s\S]*?(?=## Usage)/, "");
    const r = prepareRoadmapUpdate({ workspaceRoot: ws, filePath: abs, content: noGoal });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("heading order");
    expect(r.errors).not.toContain(extra("Context"));
    expect(fs.readFileSync(abs, "utf8")).toBe(before);
  });
});
