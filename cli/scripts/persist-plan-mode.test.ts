import path from "node:path";

import { describe, expect, it } from "vitest";

import { VALID_PLAN, savedOk } from "./fixtures/persist-bodies.ts";
import { read, update, useTmpWs, withEntries } from "./fixtures/persist-plan-kit.ts";
import { validatePlan } from "./persist-plan-validate.ts";
import { persistPlan } from "./persist-plan.ts";

const tmpWs = useTmpWs();

const CREATED = "2026-08-26T14:30:00Z";
const MODE_KEY = "mode: ask|auto|away";
function withMode(body: string, value: string) {
  return body.replace(/^strategy:.*$/m, (l) => `${l}\nmode: ${value}`);
}

describe("plan mode moves and fences", () => {
  it("moves a body mode line into the frontmatter right after strategy and out of the body", () => {
    const ws = tmpWs();
    const r = persistPlan({ content: withMode(VALID_PLAN, "away"), created: CREATED, workspaceRoot: ws });
    expect(r.ok, r.error).toBe(true);
    const text = read(path.join(ws, savedOk(r).path));
    const [head, ...body] = text.split("\n---\n");
    expect(head).toMatch(/\nstrategy: default\nmode: away$/);
    expect(body.join("\n---\n")).not.toMatch(/^mode:/m);
    expect(validatePlan(savedOk(r).filename, text)).toStrictEqual([]);
  });

  it("leaves a mode line inside a code fence alone", () => {
    const ws = tmpWs();
    const fenced = VALID_PLAN.replace("## Context", "```console\nmode: later\n```\n\n## Context");
    const r = persistPlan({ content: fenced, created: CREATED, workspaceRoot: ws });
    expect(r.ok, r.error).toBe(true);
    const text = read(path.join(ws, savedOk(r).path));
    expect(text.split("\n---\n")[0]).not.toMatch(/^mode:/m);
    expect(text).toMatch(/^```console\nmode: later\n```$/m);
  });
});

describe("plan mode denials", () => {
  it("denies an unknown mode on a body line or in the frontmatter and says the three values", () => {
    const ws = tmpWs();
    const r = persistPlan({ content: withMode(VALID_PLAN, "later"), created: CREATED, workspaceRoot: ws });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain(MODE_KEY);
    const ok = persistPlan({ content: VALID_PLAN, created: CREATED, workspaceRoot: ws });
    expect(ok.ok, ok.error).toBe(true);
    const abs = path.join(ws, savedOk(ok).path);
    const full = update(ws, abs, withMode(read(abs), "later"));
    expect(full.ok).toBe(false);
    expect(full.errors).toContain(MODE_KEY);
    const body = update(ws, abs, withMode(VALID_PLAN, "later"));
    expect(body.ok).toBe(false);
    expect(body.errors).toContain(MODE_KEY);
  });
});

describe("plan mode updates", () => {
  it("stays valid with no mode and keeps a saved mode on a body-only update", () => {
    const ws = tmpWs();
    const none = persistPlan({ content: VALID_PLAN, created: CREATED, workspaceRoot: ws });
    expect(none.ok, none.error).toBe(true);
    expect(read(path.join(ws, savedOk(none).path))).not.toMatch(/^mode:/m);
    const r = persistPlan({ content: withMode(VALID_PLAN, "auto"), created: CREATED, workspaceRoot: ws });
    expect(r.ok, r.error).toBe(true);
    const abs = path.join(ws, savedOk(r).path);
    const kept = update(ws, abs, VALID_PLAN.replace("Existing ignore entries stay.", "Other entries stay."));
    expect(kept.ok, kept.error).toBe(true);
    expect(read(abs)).toMatch(/^strategy: default\nmode: auto$/m);
    const changed = update(ws, abs, withMode(VALID_PLAN, "away"));
    expect(changed.ok, changed.error).toBe(true);
    expect(read(abs).match(/^mode:/gm)).toStrictEqual(["mode:"]);
    expect(read(abs)).toMatch(/^mode: away$/m);
  });
});

const ENTRY = "- decision: a → b because c";

describe("plan decision entries", () => {
  it("saves a decision entry and denies an update that edits or drops it", () => {
    const ws = tmpWs();
    const r = persistPlan({ content: withEntries(VALID_PLAN, ENTRY), created: CREATED, workspaceRoot: ws });
    expect(r.ok, r.error).toBe(true);
    const abs = path.join(ws, savedOk(r).path);
    const before = read(abs);
    for (const content of [
      withEntries(before, "(none)"),
      withEntries(before, ENTRY.replace("because c", "because d")),
    ]) {
      const u = update(ws, abs, content);
      expect(u.ok).toBe(false);
      expect(u.error).toContain(`keep this entry unchanged: ${ENTRY}`);
    }
    expect(read(abs)).toBe(before);
  });
});
