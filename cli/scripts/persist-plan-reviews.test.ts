import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { VALID_PLAN, savedOk } from "./fixtures/persist-bodies.ts";
import { read, update, useTmpWs } from "./fixtures/persist-plan-kit.ts";
import { persistPlan } from "./persist-plan.ts";

const tmpWs = useTmpWs();

function fresh(ws: string) {
  const r = persistPlan({ workspaceRoot: ws, content: VALID_PLAN, created: "2026-08-26T14:30:00Z" });
  expect(r.ok, r.error).toBe(true);
  return path.join(ws, savedOk(r).path);
}
const start = (t: string) => t.replace("status: ready", "status: in-progress");
const reviews = (t: string, n: string) => t.replace(/^reviews: .*$/m, `reviews: ${n}`);
const legacy = (t: string) => t.replace(/^reviews: .*\n/m, "");

describe("review rounds gate", () => {
  it("saves a new plan with reviews: 0", () => {
    expect(read(fresh(tmpWs()))).toMatch(/^reviews: 0$/m);
  });

  it("refuses to start an unreviewed plan and says how to fix it", () => {
    const ws = tmpWs();
    const abs = fresh(ws);
    const r = update(ws, abs, start(read(abs)));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/\/review-plan/);
    expect(r.error).toMatch(/reviews/);
  });

  it("starts a plan after one review round", () => {
    const ws = tmpWs();
    const abs = fresh(ws);
    const r = update(ws, abs, start(reviews(read(abs), "1")));
    expect(r.ok, r.error).toBe(true);
  });

  it("denies lowering or dropping the count", () => {
    const ws = tmpWs();
    const abs = fresh(ws);
    expect(update(ws, abs, reviews(read(abs), "2")).ok).toBe(true);
    for (const content of [reviews(read(abs), "1"), legacy(read(abs))]) {
      const r = update(ws, abs, content);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/reviews/);
    }
  });
});

describe("review rounds count and legacy", () => {
  it("denies a count that is not a plain whole number", () => {
    const ws = tmpWs();
    const abs = fresh(ws);
    for (const n of ["-1", "x", "01"]) {
      const r = update(ws, abs, reviews(read(abs), n));
      expect(r.ok, n).toBe(false);
      expect(r.error, n).toMatch(/reviews/);
    }
  });

  it("keeps a legacy plan already in progress editable without reviews", () => {
    const ws = tmpWs();
    const abs = fresh(ws);
    fs.writeFileSync(abs, start(legacy(read(abs))));
    const r = update(ws, abs, read(abs).replace("1.1 [ ]", "1.1 [x]"));
    expect(r.ok, r.error).toBe(true);
  });

  it("gates a legacy ready plan without reviews", () => {
    const ws = tmpWs();
    const abs = fresh(ws);
    fs.writeFileSync(abs, legacy(read(abs)));
    const r = update(ws, abs, start(read(abs)));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/\/review-plan/);
  });
});
