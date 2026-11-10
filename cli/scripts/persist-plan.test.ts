import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { VALID_PLAN, savedOk } from "./fixtures/persist-bodies.ts";
import { useTmpWs } from "./fixtures/persist-plan-kit.ts";
import { slugify, utcDateTime } from "./persist-doc.ts";
import { persistPlan } from "./persist-plan.ts";
import { PLAN_DIR } from "./persist-plan.constants.ts";
import { validatePlan } from "./persist-plan-validate.ts";

const tmpWs = useTmpWs();

describe("slugify", () => {
  it("lowercases, hyphenates, trims to 50", () => {
    expect(slugify("Add Auth!")).toBe("add-auth");
    expect(slugify("")).toBe("unnamed");
  });
});

describe("utcDateTime", () => {
  it("strips milliseconds and keeps Z", () => {
    expect(utcDateTime(new Date("2026-08-26T14:30:00.123Z"))).toBe("2026-08-26T14:30:00Z");
  });
});

describe("persistPlan file", () => {
  it("writes a valid plan with unpadded serial, datetime created, and stamp", () => {
    const ws = tmpWs();
    const created = "2026-08-26T14:30:00Z";
    const r = persistPlan({
      workspaceRoot: ws,
      content: VALID_PLAN,
      created,
    });
    expect(r.ok).toBe(true);
    expect(r.serial).toBe(1);
    expect(r.filename).toBe("1-add-tmp-ignore-20260826T143000Z.md");
    expect(r.path).toBe(`${PLAN_DIR}/${r.filename}`);
    expect(path.isAbsolute(savedOk(r).path)).toBe(false);
    expect(fs.existsSync(path.join(ws, savedOk(r).path))).toBe(true);
    const text = fs.readFileSync(path.join(ws, savedOk(r).path), "utf8");
    expect(text).toMatch(/^---\nserial: 1\n/);
    expect(text).toMatch(/^name: add-tmp-ignore$/m);
    expect(text).toMatch(/^created: 2026-08-26T14:30:00Z$/m);
    expect(text).not.toMatch(/serial: 0001/);
    expect(validatePlan(savedOk(r).filename, text)).toEqual([]);
  });
});

describe("persistPlan stamps and gitignore", () => {
  it("never touches .gitignore", () => {
    const ws = tmpWs();
    persistPlan({ workspaceRoot: ws, content: VALID_PLAN });
    expect(fs.existsSync(path.join(ws, ".gitignore"))).toBe(false);
    const kept = tmpWs();
    fs.writeFileSync(path.join(kept, ".gitignore"), "node_modules\n");
    persistPlan({ workspaceRoot: kept, content: VALID_PLAN });
    persistPlan({ workspaceRoot: kept, content: VALID_PLAN });
    expect(fs.readFileSync(path.join(kept, ".gitignore"), "utf8")).toBe("node_modules\n");
  });

  it("stamps filename from created when created is omitted", () => {
    const ws = tmpWs();
    const r = persistPlan({ workspaceRoot: ws, content: VALID_PLAN });
    expect(r.ok).toBe(true);
    expect(r.filename).toMatch(/^1-add-tmp-ignore-\d{8}T\d{6}Z\.md$/);
    const text = fs.readFileSync(path.join(ws, savedOk(r).path), "utf8");
    const m = text.match(/^created: (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)$/m);
    expect(m).toBeTruthy();
    expect(r.filename).toBe(`1-add-tmp-ignore-${String(m?.[1]).replace(/[-:]/g, "")}.md`);
  });
});

describe("persistPlan serials", () => {
  it("accepts legacy unstamped filename and date-only created", () => {
    const ws = tmpWs();
    const r = persistPlan({
      workspaceRoot: ws,
      content: VALID_PLAN,
      created: "2026-08-26T14:30:00Z",
    });
    expect(r.ok).toBe(true);
    const legacy = String(r.content).replace(/^created: 2026-08-26T14:30:00Z$/m, "created: 2026-08-26");
    expect(validatePlan("1-add-tmp-ignore.md", legacy)).toEqual([]);
  });

  it("increments serial and keeps the same stamp", () => {
    const ws = tmpWs();
    const created = "2026-08-26T14:30:00Z";
    persistPlan({ workspaceRoot: ws, content: VALID_PLAN, created });
    const r = persistPlan({
      workspaceRoot: ws,
      content: VALID_PLAN,
      created,
    });
    expect(r.ok).toBe(true);
    expect(r.serial).toBe(2);
    expect(r.filename).toBe("2-add-tmp-ignore-20260826T143000Z.md");
  });
});

const created = "2026-08-26T14:30:00Z";

describe("persistPlan commit subject", () => {
  it("keeps a valid commit subject and allows a plan with no commit", () => {
    const ws = tmpWs();
    const good = persistPlan({
      workspaceRoot: ws,
      content: "commit: feat(plans): record the subject\n" + VALID_PLAN,
      created,
    });
    expect(good.ok).toBe(true);
    const text = fs.readFileSync(path.join(ws, savedOk(good).path), "utf8");
    expect(text).toMatch(/^commit: feat\(plans\): record the subject$/m);
    expect(validatePlan(savedOk(good).filename, text)).toEqual([]);
    const noCommit = text.replace(/^commit:.*\n/m, "");
    expect(validatePlan(savedOk(good).filename, noCommit)).toEqual([]);
  });
});

describe("persistPlan other commit subjects", () => {
  it("accepts other conventional subjects", () => {
    const ws = tmpWs();
    for (const subject of [
      "chore: ignore .tmp",
      "fix(hook): don't reset status",
      "docs: document docs/roadmaps",
      "docs: note plans, roadmaps: split",
    ]) {
      const ok = persistPlan({ workspaceRoot: ws, content: `commit: ${subject}\n` + VALID_PLAN, created });
      expect(ok.ok, subject).toBe(true);
    }
  });

  it("rejects a bad subject", () => {
    const ws = tmpWs();
    const bad = persistPlan({ workspaceRoot: ws, content: "commit: Feat: Nope.\n" + VALID_PLAN, created });
    expect(bad.ok).toBe(false);
    expect(bad.errors).toContain("commit");
    const period = persistPlan({ workspaceRoot: ws, content: "commit: feat: nope.\n" + VALID_PLAN, created });
    expect(period.ok).toBe(false);
    expect(period.errors).toContain("commit");
  });
});

describe("persistPlan refusals and location", () => {
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

  it("writes under PLAN_DIR", () => {
    const ws = tmpWs();
    const r = persistPlan({
      workspaceRoot: ws,
      content: VALID_PLAN,
      created: "2026-08-26T14:30:00Z",
    });
    expect(r.ok).toBe(true);
    expect(r.path).toBe(`${PLAN_DIR}/${r.filename}`);
    expect(fs.existsSync(path.join(ws, savedOk(r).path))).toBe(true);
  });
});
