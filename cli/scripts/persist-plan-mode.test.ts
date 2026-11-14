import path from "node:path";

import { describe, expect, it } from "vitest";

import { VALID_PLAN, savedOk } from "./__fixtures__/persist-bodies.ts";
import { read, update, useTmpWs, withEntries } from "./__fixtures__/persist-plan-kit.ts";
import { validatePlan } from "./persist-plan-validate.ts";
import { persistPlan } from "./persist-plan.ts";

const tmpWs = useTmpWs();

const CREATED = "2026-08-26T14:30:00Z";
const APPROVAL_KEY = "approval: ask|away";

function withApproval(body: string, value: string) {
  return body.replace(/^strategy:.*$/m, (l) => `${l}\napproval: ${value}`);
}

describe("plan approval moves and fences", () => {
  it("moves a body approval line into the frontmatter right after strategy and out of the body", () => {
    const ws = tmpWs();
    const r = persistPlan({ content: withApproval(VALID_PLAN, "away"), created: CREATED, workspaceRoot: ws });
    expect(r.ok, r.error).toBe(true);
    const text = read(path.join(ws, savedOk(r).path));
    const [head, ...body] = text.split("\n---\n");
    expect(head).toMatch(/\nstrategy: free\napproval: away$/);
    expect(body.join("\n---\n")).not.toMatch(/^approval:/m);
    expect(validatePlan(savedOk(r).filename, text)).toStrictEqual([]);
  });

  it("leaves an approval line inside a code fence alone", () => {
    const ws = tmpWs();
    const fenced = VALID_PLAN.replace("## Context", "```console\napproval: later\n```\n\n## Context");
    const r = persistPlan({ content: fenced, created: CREATED, workspaceRoot: ws });
    expect(r.ok, r.error).toBe(true);
    const text = read(path.join(ws, savedOk(r).path));
    expect(text.split("\n---\n")[0]).not.toMatch(/^approval:/m);
    expect(text).toMatch(/^```console\napproval: later\n```$/m);
  });
});

describe("plan approval denials", () => {
  it("denies an unknown approval on a body line or in the frontmatter and says the three values", () => {
    const ws = tmpWs();
    const r = persistPlan({ content: withApproval(VALID_PLAN, "later"), created: CREATED, workspaceRoot: ws });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain(APPROVAL_KEY);
    const ok = persistPlan({ content: VALID_PLAN, created: CREATED, workspaceRoot: ws });
    expect(ok.ok, ok.error).toBe(true);
    const abs = path.join(ws, savedOk(ok).path);
    const full = update(ws, abs, withApproval(read(abs), "later"));
    expect(full.ok).toBe(false);
    expect(full.errors).toContain(APPROVAL_KEY);
    const body = update(ws, abs, withApproval(VALID_PLAN, "later"));
    expect(body.ok).toBe(false);
    expect(body.errors).toContain(APPROVAL_KEY);
  });
});

describe("plan mode key", () => {
  it("denies a save that sends the old mode key and names approval", () => {
    const ws = tmpWs();
    const old = VALID_PLAN.replace("strategy: free", "strategy: free\nmode: away");
    const r = persistPlan({ content: old, created: CREATED, workspaceRoot: ws });

    expect(r.errors).toContain("mode: is now approval:; use approval: ask|away");
  });
});

describe("plan approval updates", () => {
  it("stays valid with no approval and keeps a saved approval on a body-only update", () => {
    const ws = tmpWs();
    const none = persistPlan({ content: VALID_PLAN, created: CREATED, workspaceRoot: ws });
    expect(none.ok, none.error).toBe(true);
    expect(read(path.join(ws, savedOk(none).path))).not.toMatch(/^approval:/m);
    const r = persistPlan({ content: withApproval(VALID_PLAN, "ask"), created: CREATED, workspaceRoot: ws });
    expect(r.ok, r.error).toBe(true);
    const abs = path.join(ws, savedOk(r).path);
    const kept = update(ws, abs, VALID_PLAN.replace("Existing ignore entries stay.", "Other entries stay."));
    expect(kept.ok, kept.error).toBe(true);
    expect(read(abs)).toMatch(/^strategy: free\napproval: ask$/m);
    const changed = update(ws, abs, withApproval(VALID_PLAN, "away"));
    expect(changed.ok, changed.error).toBe(true);
    expect(read(abs).match(/^approval:/gm)).toStrictEqual(["approval:"]);
    expect(read(abs)).toMatch(/^approval: away$/m);
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
