import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LEGACY_PLAN_DIR,
  PLAN_DIR,
  migrateLegacyPlansDir,
  persistPlan,
  slugify,
  utcDateTime,
  validatePlan,
} from "./persist-plan.mjs";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function tmpWs() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "persist-plan-"));
  tmpDirs.push(dir);
  return dir;
}

export const VALID_THINKER = `PLAN_NAME: add tmp ignore

# add-tmp-ignore

## Goal
Repo .gitignore ignores .tmp/ so files under .tmp/grunt/plans/ stay untracked. Existing ignore entries stay.

## Context
- Plans live under .tmp/grunt/plans/

## Constraints
- Do not clobber other .gitignore lines

## Watch-outs
- Duplicate .tmp/ if append without grep

## Steps
1 [ ] gitignore
1.1 [ ] read the gitignore if it exists
1.2 [ ] append .tmp/ when absent

## Verify
2 [ ] Verify
2.1 [ ] git check-ignore reports ignored
`;

describe("slugify", () => {
  it("lowercases, hyphenates, trims to 50", () => {
    expect(slugify("Add Auth!")).toBe("add-auth");
    expect(slugify("")).toBe("unnamed");
  });
});

describe("utcDateTime", () => {
  it("strips milliseconds and keeps Z", () => {
    expect(utcDateTime(new Date("2026-08-26T14:30:00.123Z"))).toBe(
      "2026-08-26T14:30:00Z",
    );
  });
});

describe("persistPlan", () => {
  it("writes a valid plan with unpadded serial, datetime created, and stamp", () => {
    const ws = tmpWs();
    const created = "2026-08-26T14:30:00Z";
    const r = persistPlan({
      workspaceRoot: ws,
      content: VALID_THINKER,
      created,
    });
    expect(r.ok).toBe(true);
    expect(r.serial).toBe(1);
    expect(r.filename).toBe("1-add-tmp-ignore-20260826T143000Z.md");
    expect(r.path).toBe(`${PLAN_DIR}/${r.filename}`);
    expect(path.isAbsolute(r.path)).toBe(false);
    expect(fs.existsSync(path.join(ws, r.path))).toBe(true);
    const text = fs.readFileSync(path.join(ws, r.path), "utf8");
    expect(text).toMatch(/^---\nserial: 1\n/);
    expect(text).toMatch(/^name: add-tmp-ignore$/m);
    expect(text).toMatch(/^created: 2026-08-26T14:30:00Z$/m);
    expect(text).not.toMatch(/serial: 0001/);
    expect(validatePlan(r.filename, text)).toEqual([]);
    expect(fs.readFileSync(path.join(ws, ".gitignore"), "utf8")).toMatch(
      /^\.tmp\/$/m,
    );
  });

  it("stamps filename from created when created is omitted", () => {
    const ws = tmpWs();
    const r = persistPlan({ workspaceRoot: ws, content: VALID_THINKER });
    expect(r.ok).toBe(true);
    expect(r.filename).toMatch(/^1-add-tmp-ignore-\d{8}T\d{6}Z\.md$/);
    const text = fs.readFileSync(path.join(ws, r.path!), "utf8");
    const m = text.match(/^created: (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)$/m);
    expect(m).toBeTruthy();
    expect(r.filename).toBe(
      `1-add-tmp-ignore-${m![1].replace(/[-:]/g, "")}.md`,
    );
  });

  it("accepts legacy unstamped filename and date-only created", () => {
    const ws = tmpWs();
    const r = persistPlan({
      workspaceRoot: ws,
      content: VALID_THINKER,
      created: "2026-08-26T14:30:00Z",
    });
    expect(r.ok).toBe(true);
    const legacy = String(r.content).replace(
      /^created: 2026-08-26T14:30:00Z$/m,
      "created: 2026-08-26",
    );
    expect(validatePlan("1-add-tmp-ignore.md", legacy)).toEqual([]);
  });

  it("increments serial and keeps the same stamp", () => {
    const ws = tmpWs();
    const created = "2026-08-26T14:30:00Z";
    persistPlan({ workspaceRoot: ws, content: VALID_THINKER, created });
    const r = persistPlan({
      workspaceRoot: ws,
      content: VALID_THINKER,
      created,
    });
    expect(r.ok).toBe(true);
    expect(r.serial).toBe(2);
    expect(r.filename).toBe("2-add-tmp-ignore-20260826T143000Z.md");
  });

  it("keeps a valid commit subject, allows a plan with no commit, and rejects a bad subject", () => {
    const ws = tmpWs();
    const good = persistPlan({
      workspaceRoot: ws,
      content: "commit: feat(plans): record the subject\n" + VALID_THINKER,
      created: "2026-08-26T14:30:00Z",
    });
    expect(good.ok).toBe(true);
    const text = fs.readFileSync(path.join(ws, good.path!), "utf8");
    expect(text).toMatch(/^commit: feat\(plans\): record the subject$/m);
    expect(validatePlan(good.filename!, text)).toEqual([]);
    const noCommit = text.replace(/^commit:.*\n/m, "");
    expect(validatePlan(good.filename!, noCommit)).toEqual([]);
    for (const subject of [
      "chore: ignore .tmp",
      "fix(hook): don't reset status",
      "docs: document docs/roadmaps",
      "docs: note plans, roadmaps: split",
    ]) {
      const ok = persistPlan({
        workspaceRoot: ws,
        content: `commit: ${subject}\n` + VALID_THINKER,
        created: "2026-08-26T14:30:00Z",
      });
      expect(ok.ok, subject).toBe(true);
    }
    const bad = persistPlan({
      workspaceRoot: ws,
      content: "commit: Feat: Nope.\n" + VALID_THINKER,
      created: "2026-08-26T14:30:00Z",
    });
    expect(bad.ok).toBe(false);
    expect(bad.errors).toContain("commit");
    const period = persistPlan({
      workspaceRoot: ws,
      content: "commit: feat: nope.\n" + VALID_THINKER,
      created: "2026-08-26T14:30:00Z",
    });
    expect(period.ok).toBe(false);
    expect(period.errors).toContain("commit");
  });

  it("rejects an invalid plan and does not write", () => {
    const ws = tmpWs();
    const r = persistPlan({
      workspaceRoot: ws,
      content: "PLAN_NAME: nope\n\n# nope\n\nnot a plan\n",
    });
    expect(r.ok).toBe(false);
    expect(fs.existsSync(path.join(ws, PLAN_DIR))).toBe(true);
    expect(fs.readdirSync(path.join(ws, PLAN_DIR))).toEqual([]);
  });

  it("writes under PLAN_DIR not legacy", () => {
    const ws = tmpWs();
    const r = persistPlan({
      workspaceRoot: ws,
      content: VALID_THINKER,
      created: "2026-08-26T14:30:00Z",
    });
    expect(r.ok).toBe(true);
    expect(r.path).toBe(`${PLAN_DIR}/${r.filename}`);
    expect(fs.existsSync(path.join(ws, LEGACY_PLAN_DIR))).toBe(false);
  });

  it("renames legacy plans dir when new is missing", () => {
    const ws = tmpWs();
    const legacy = path.join(ws, LEGACY_PLAN_DIR);
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(path.join(legacy, "9-old-20260826T143000Z.md"), "x");
    expect(migrateLegacyPlansDir(ws)).toBe(path.join(ws, PLAN_DIR));
    expect(fs.existsSync(legacy)).toBe(false);
    expect(fs.existsSync(path.join(ws, PLAN_DIR, "9-old-20260826T143000Z.md"))).toBe(
      true,
    );
    const r = persistPlan({
      workspaceRoot: ws,
      content: VALID_THINKER,
      created: "2026-08-26T14:30:00Z",
    });
    expect(r.ok).toBe(true);
    expect(r.serial).toBe(10);
    expect(r.path).toBe(`${PLAN_DIR}/${r.filename}`);
  });

  it("leaves legacy plans when both dirs exist", () => {
    const ws = tmpWs();
    const legacy = path.join(ws, LEGACY_PLAN_DIR);
    const next = path.join(ws, PLAN_DIR);
    fs.mkdirSync(legacy, { recursive: true });
    fs.mkdirSync(next, { recursive: true });
    fs.writeFileSync(path.join(legacy, "9-old-20260826T143000Z.md"), "x");
    migrateLegacyPlansDir(ws);
    expect(fs.existsSync(path.join(legacy, "9-old-20260826T143000Z.md"))).toBe(
      true,
    );
    const r = persistPlan({
      workspaceRoot: ws,
      content: VALID_THINKER,
      created: "2026-08-26T14:30:00Z",
    });
    expect(r.ok).toBe(true);
    expect(r.serial).toBe(1);
    expect(fs.existsSync(path.join(legacy, "9-old-20260826T143000Z.md"))).toBe(
      true,
    );
  });
});
