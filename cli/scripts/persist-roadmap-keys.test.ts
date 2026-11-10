import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DRAFT_ROADMAP, savedOk } from "./fixtures/persist-bodies.ts";
import { read, useTmpWs } from "./fixtures/persist-plan-kit.ts";
import { CREATED, update } from "./fixtures/persist-roadmap-kit.ts";
import { persistRoadmap } from "./persist-roadmap.ts";

const tmpWs = useTmpWs("persist-roadmap-");
const ROADMAPS = ".tmp/repo/roadmaps";
const NO_KEY = "strategy: default|review-fast|review-deep";
const MODE_KEY = "mode: ask|auto|away";
const without = (body: string) => body.replace(/^strategy:.*\n/m, "");
const withStrategy = (body: string, value: string) => body.replace(/^strategy:.*$/m, `strategy: ${value}`);
const withMode = (body: string, value: string) => body.replace(/^strategy:.*$/m, (l) => `${l}\nmode: ${value}`);
const save = (content: string, ws = tmpWs()) => persistRoadmap({ workspaceRoot: ws, content, created: CREATED });

describe("roadmap strategy on a new save", () => {
  it("moves a body strategy line into the frontmatter after source and out of the body", () => {
    const ws = tmpWs();
    const r = save(withStrategy(DRAFT_ROADMAP, "review-deep"), ws);
    expect(r.ok, r.error).toBe(true);
    const [head, ...body] = read(path.join(ws, savedOk(r).path)).split("\n---\n");
    expect(head).toMatch(/\nsource: "auth program"\nstrategy: review-deep$/);
    expect(body.join("\n---\n")).not.toMatch(/^strategy:/m);
  });

  it("denies a save without it and an unknown value", () => {
    const ws = tmpWs();
    const missing = save(without(DRAFT_ROADMAP), ws);
    expect(missing.ok).toBe(false);
    expect(missing.errors).toContain(NO_KEY);
    const unknown = save(withStrategy(DRAFT_ROADMAP, "review-medium"), ws);
    expect(unknown.ok).toBe(false);
    expect(unknown.errors).toContain(NO_KEY);
    expect(fs.readdirSync(path.join(ws, ROADMAPS))).toEqual([]);
  });
});

describe("roadmap strategy on an update", () => {
  it("keeps the key on a body-only update", () => {
    const ws = tmpWs();
    const abs = path.join(ws, savedOk(save(withStrategy(DRAFT_ROADMAP, "review-fast"), ws)).path);
    const body = without(DRAFT_ROADMAP).replace("strip narrating comments.", "strip narrating comments and logs.");
    const kept = update(ws, abs, body);
    expect(kept.ok, kept.error).toBe(true);
    expect(read(abs)).toMatch(/^strategy: review-fast$/m);
  });

  it("takes a new one, and denies a frontmatter without it", () => {
    const ws = tmpWs();
    const abs = path.join(ws, savedOk(save(withStrategy(DRAFT_ROADMAP, "review-fast"), ws)).path);
    const changed = update(ws, abs, withStrategy(DRAFT_ROADMAP, "default"));
    expect(changed.ok, changed.error).toBe(true);
    expect(read(abs)).toMatch(/^strategy: default$/m);
    expect(read(abs).match(/^strategy:/gm)).toHaveLength(1);
    const full = update(ws, abs, read(abs).replace(/^strategy:.*\n/m, ""));
    expect(full.ok).toBe(false);
    expect(full.errors).toContain(NO_KEY);
  });
});

describe("roadmap mode on a new save", () => {
  it("moves a body mode line into the frontmatter right after strategy and out of the body", () => {
    const ws = tmpWs();
    const r = save(withMode(DRAFT_ROADMAP, "away"), ws);
    expect(r.ok, r.error).toBe(true);
    const [head, ...body] = read(path.join(ws, savedOk(r).path)).split("\n---\n");
    expect(head).toMatch(/\nstrategy: default\nmode: away$/);
    expect(body.join("\n---\n")).not.toMatch(/^mode:/m);
  });

  it("denies an unknown mode on a body line or in the frontmatter", () => {
    const ws = tmpWs();
    const bad = save(withMode(DRAFT_ROADMAP, "later"), ws);
    expect(bad.ok).toBe(false);
    expect(bad.errors).toContain(MODE_KEY);
    expect(fs.readdirSync(path.join(ws, ROADMAPS))).toEqual([]);
    const ok = save(DRAFT_ROADMAP, ws);
    expect(ok.ok, ok.error).toBe(true);
    const abs = path.join(ws, savedOk(ok).path);
    expect(read(abs)).not.toMatch(/^mode:/m);
    const full = update(ws, abs, withMode(read(abs), "later"));
    expect(full.ok).toBe(false);
    expect(full.errors).toContain(MODE_KEY);
  });
});

describe("roadmap mode on an update", () => {
  it("keeps a saved mode on a body-only update and takes a new one", () => {
    const ws = tmpWs();
    const r = save(withMode(DRAFT_ROADMAP, "auto"), ws);
    expect(r.ok, r.error).toBe(true);
    const abs = path.join(ws, savedOk(r).path);
    const kept = update(ws, abs, DRAFT_ROADMAP.replace(/^strategy:.*\n/m, ""));
    expect(kept.ok, kept.error).toBe(true);
    expect(read(abs)).toMatch(/^mode: auto$/m);
    const changed = update(ws, abs, withMode(DRAFT_ROADMAP, "ask"));
    expect(changed.ok, changed.error).toBe(true);
    expect(read(abs).match(/^mode:/gm)).toEqual(["mode:"]);
    expect(read(abs)).toMatch(/^mode: ask$/m);
  });
});
