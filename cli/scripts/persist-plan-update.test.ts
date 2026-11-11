import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { VALID_PLAN, savedOk } from "./fixtures/persist-bodies.ts";
import { read, update, useTmpWs, withEntries } from "./fixtures/persist-plan-kit.ts";
import { validatePlan } from "./persist-plan-validate.ts";
import { PLAN_DIR } from "./persist-plan.constants.ts";
import { persistPlan } from "./persist-plan.ts";

const tmpWs = useTmpWs();
const CREATED = "2026-08-26T14:30:00Z";
const ENTRY = "- feedback: ignore entry lacked the slash → writes `.tmp/`";

function saved(ws: string) {
  const r = persistPlan({ content: VALID_PLAN, created: CREATED, workspaceRoot: ws });
  expect(r.ok, r.error).toBe(true);
  return { ...r, abs: path.join(ws, savedOk(r).path) };
}

describe("plan updates in place", () => {
  it("rewrites an existing plan in place, keeping serial, created, and the given status", () => {
    const ws = tmpWs();
    const s = saved(ws);
    const body = read(s.abs)
      .replace("status: ready", "status: in-progress")
      .replace("reviews: 0", "reviews: 1")
      .replace("1.1 [ ]", "1.1 [x]");
    const r = update(ws, s.abs, body);
    expect(r.ok, r.error).toBe(true);
    expect(r.path).toBe(s.path);
    expect(r.serial).toBe(1);
    expect(fs.readdirSync(path.join(ws, PLAN_DIR))).toStrictEqual([s.filename]);
    const text = read(s.abs);
    expect(text).toMatch(/^status: in-progress$/m);
    expect(text).toMatch(/^created: 2026-08-26T14:30:00Z$/m);
    expect(text).toMatch(/^1\.1 \[x\] /m);
  });

  it("denies a body-only rewrite of a saved file that has no frontmatter instead of throwing", () => {
    const ws = tmpWs();
    const s = saved(ws);
    fs.writeFileSync(s.abs, "# add-tmp-ignore\n\nhand-written\n");
    const r = update(ws, s.abs, VALID_PLAN);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/frontmatter/);
  });
});

describe("plan updates keeping the saved head", () => {
  it("keeps the saved frontmatter when a revision sends only the body", () => {
    const ws = tmpWs();
    const s = saved(ws);
    const revised = VALID_PLAN.replace("Existing ignore entries stay.", "Other entries stay.");
    const r = update(ws, s.abs, revised);
    expect(r.ok, r.error).toBe(true);
    expect(fs.readdirSync(path.join(ws, PLAN_DIR))).toStrictEqual([s.filename]);
    const text = read(s.abs);
    expect(text).toMatch(/^serial: 1$/m);
    expect(text).toMatch(/^created: 2026-08-26T14:30:00Z$/m);
    expect(text).toContain("Other entries stay.");
  });

  it("denies a fresh plan without Previous mistakes and says how to fix it", () => {
    const ws = tmpWs();
    const r = persistPlan({
      content: VALID_PLAN.replace(/\n## Previous mistakes\n\(none\)\n$/, "\n"),
      workspaceRoot: ws,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/## Previous mistakes/);
    expect(r.error).toMatch(/\(none\)/);
  });
});

describe("plan updates and Previous mistakes order", () => {
  it("updates a legacy plan that has no Previous mistakes", () => {
    const ws = tmpWs();
    const s = saved(ws);
    const legacy = read(s.abs).replace(/\n## Previous mistakes\n\(none\)\n$/, "\n");
    fs.writeFileSync(s.abs, legacy);
    const r = update(ws, s.abs, legacy.replace("1.1 [ ]", "1.1 [x]"));
    expect(r.ok, r.error).toBe(true);
  });

  it("denies Previous mistakes anywhere but last", () => {
    const ws = tmpWs();
    const s = saved(ws);
    const moved = read(s.abs)
      .replace(/\n## Previous mistakes\n\(none\)\n$/, "\n")
      .replace("## Verify", "## Previous mistakes\n(none)\n\n## Verify");
    expect(validatePlan(savedOk(s).filename, moved).join("; ")).toMatch(/Previous mistakes.*last/);
  });

  it("accepts an update that appends an entry", () => {
    const ws = tmpWs();
    const s = saved(ws);
    const one = update(ws, s.abs, withEntries(read(s.abs), ENTRY));
    expect(one.ok, one.error).toBe(true);
    const next = "- verify: check-ignore ran from the wrong dir → runs from the repo root (lesson: run-from-root)";
    const two = update(ws, s.abs, withEntries(read(s.abs), ENTRY, next));
    expect(two.ok, two.error).toBe(true);
    expect(read(s.abs)).toContain(next);
  });
});

describe("plan updates that change an entry", () => {
  it("denies an update that changes or drops an existing entry and names it", () => {
    const ws = tmpWs();
    const s = saved(ws);
    update(ws, s.abs, withEntries(read(s.abs), ENTRY));
    const before = read(s.abs);
    for (const content of [
      withEntries(before, "(none)"),
      withEntries(before, ENTRY.replace("slash", "dot")),
      before.replace(/\n## Previous mistakes\n[\s\S]*$/, "\n"),
    ]) {
      const r = update(ws, s.abs, content);
      expect(r.ok).toBe(false);
      expect(r.error).toContain("ignore entry lacked the slash");
    }
    expect(read(s.abs)).toBe(before);
  });

  it("denies an entry with an unknown source or no arrow", () => {
    const ws = tmpWs();
    const s = saved(ws);
    for (const bad of ["- oops: wrong thing → fixed", "- feedback: wrong thing, fixed"]) {
      const r = update(ws, s.abs, withEntries(read(s.abs), bad));
      expect(r.ok, bad).toBe(false);
      expect(r.error).toContain(bad);
    }
  });
});

describe("plan entry kinds", () => {
  it("rejects a roadmap-only slice entry on a plan", () => {
    const ws = tmpWs();
    const body = VALID_PLAN.replace("## Previous mistakes\n(none)", "## Previous mistakes\n- slice: a → b");
    const r = persistPlan({ content: body, workspaceRoot: ws });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/feedback\|verify\|review\|premise\|decision\}/);
  });
});
