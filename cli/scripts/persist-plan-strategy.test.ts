import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { VALID_PLAN, savedOk } from "./fixtures/persist-bodies.ts";
import { read, update, useTmpWs } from "./fixtures/persist-plan-kit.ts";
import { persistPlan } from "./persist-plan.ts";
import { PLAN_DIR } from "./persist-plan.constants.ts";
import { validatePlan } from "./persist-plan-validate.ts";

const tmpWs = useTmpWs();

const created = "2026-08-26T14:30:00Z";
const NO_KEY = "strategy: default|review-fast|review-deep";
const without = (body: string) => body.replace(/^strategy:.*\n/m, "");
const withStrategy = (body: string, value: string) => body.replace(/^strategy:.*$/m, `strategy: ${value}`);

describe("plan strategy moves and fences", () => {
  it("moves a body strategy line into the frontmatter after commit and out of the body", () => {
    const ws = tmpWs();
    const r = persistPlan({
      workspaceRoot: ws,
      content: `commit: feat: add the thing\n${withStrategy(VALID_PLAN, "review-deep")}`,
      created,
    });
    expect(r.ok, r.error).toBe(true);
    const text = read(path.join(ws, savedOk(r).path));
    const [head, ...body] = text.split("\n---\n");
    expect(head).toMatch(/commit: feat: add the thing\nstrategy: review-deep$/);
    expect(body.join("\n---\n")).not.toMatch(/^strategy:/m);
    expect(validatePlan(savedOk(r).filename, text)).toStrictEqual([]);
  });

  it("leaves a strategy line inside a code fence alone", () => {
    const ws = tmpWs();
    const fenced = VALID_PLAN.replace("## Context", "```console\nstrategy: review-fast\n```\n\n## Context");
    const r = persistPlan({ workspaceRoot: ws, content: fenced, created });
    expect(r.ok, r.error).toBe(true);
    const text = read(path.join(ws, savedOk(r).path));
    expect(text).toMatch(/^strategy: default$/m);
    expect(text).toMatch(/^```console\nstrategy: review-fast\n```$/m);
  });
});

describe("plan strategy denials", () => {
  it("denies a save without it and says the three values", () => {
    const ws = tmpWs();
    const r = persistPlan({ workspaceRoot: ws, content: without(VALID_PLAN), created });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain(NO_KEY);
    expect(fs.existsSync(path.join(ws, PLAN_DIR))).toBe(true);
    expect(fs.readdirSync(path.join(ws, PLAN_DIR))).toStrictEqual([]);
  });

  it("denies an unknown or empty value", () => {
    const ws = tmpWs();
    for (const v of ["review-medium", "Default", ""]) {
      const r = persistPlan({ workspaceRoot: ws, content: withStrategy(VALID_PLAN, v), created });
      expect(r.ok, v).toBe(false);
      expect(r.errors, v).toContain(NO_KEY);
    }
  });

  it("denies an update whose frontmatter drops the key", () => {
    const ws = tmpWs();
    const r = persistPlan({ workspaceRoot: ws, content: withStrategy(VALID_PLAN, "review-fast"), created });
    const abs = path.join(ws, savedOk(r).path);
    const u = update(ws, abs, without(read(abs).replace(/^strategy:.*\n/m, "")));
    expect(u.ok).toBe(false);
    expect(u.errors).toContain(NO_KEY);
  });
});

describe("plan strategy updates", () => {
  it("keeps the key on a body-only update and takes a new one from a body line", () => {
    const ws = tmpWs();
    const r = persistPlan({ workspaceRoot: ws, content: withStrategy(VALID_PLAN, "review-fast"), created });
    const abs = path.join(ws, savedOk(r).path);
    const kept = update(ws, abs, without(VALID_PLAN).replace("Existing ignore entries stay.", "Other entries stay."));
    expect(kept.ok, kept.error).toBe(true);
    expect(read(abs)).toMatch(/^strategy: review-fast$/m);
    const changed = update(ws, abs, withStrategy(VALID_PLAN, "review-deep"));
    expect(changed.ok, changed.error).toBe(true);
    expect(read(abs)).toMatch(/^strategy: review-deep$/m);
    expect(read(abs).match(/^strategy:/gm)).toHaveLength(1);
    const bad = update(ws, abs, withStrategy(VALID_PLAN, "review-medium"));
    expect(bad.ok).toBe(false);
    expect(bad.errors).toContain(NO_KEY);
  });

  it("adds the key to a saved head that lacks it only from a body line", () => {
    const ws = tmpWs();
    const r = persistPlan({ workspaceRoot: ws, content: withStrategy(VALID_PLAN, "default"), created });
    const abs = path.join(ws, savedOk(r).path);
    fs.writeFileSync(abs, read(abs).replace(/^strategy:.*\n/m, ""));
    expect(update(ws, abs, without(VALID_PLAN)).errors).toContain(NO_KEY);
    const ok = update(ws, abs, withStrategy(VALID_PLAN, "review-fast"));
    expect(ok.ok, ok.error).toBe(true);
    expect(read(abs)).toMatch(/^source: .*\nstrategy: review-fast\n---$/m);
  });
});
