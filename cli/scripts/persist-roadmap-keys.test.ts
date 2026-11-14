import path from "node:path";

import { describe, expect, it } from "vitest";

import { useTempDirs } from "../__fixtures__/temp-dirs.ts";
import { DRAFT_ROADMAP, savedOk } from "./__fixtures__/persist-bodies.ts";
import { read } from "./__fixtures__/persist-plan-kit.ts";
import { CREATED, update } from "./__fixtures__/persist-roadmap-kit.ts";
import { expectNothingSaved } from "./__fixtures__/persist-save-kit.ts";
import { ROADMAP_DIR } from "./persist-roadmap.constants.ts";
import { persistRoadmap } from "./persist-roadmap.ts";
import type { Strategy } from "./strategy.types.ts";

const { tempDir: tmpWs } = useTempDirs("persist-roadmap-");
const NO_KEY = "strategy: free|spawn-fast|spawn-deep";
const APPROVAL_KEY = "approval: ask|away";

function without(body: string) {
  return body.replace(/^strategy:.*\n/m, "");
}

function withStrategy(body: string, value: string) {
  return body.replace(/^strategy:.*$/m, `strategy: ${value}`);
}

function withApproval(body: string, value: string) {
  return body.replace(/^strategy:.*$/m, (l) => `${l}\napproval: ${value}`);
}

function save(content: string, ws = tmpWs(), defaultStrategy?: Strategy) {
  return persistRoadmap({ content, created: CREATED, defaultStrategy, workspaceRoot: ws });
}

describe("roadmap strategy on a new save", () => {
  it("moves a body strategy line into the frontmatter after source and out of the body", () => {
    const ws = tmpWs();
    const r = save(withStrategy(DRAFT_ROADMAP, "spawn-deep"), ws);
    expect(r.ok, r.error).toBe(true);
    const [head, ...body] = read(path.join(ws, savedOk(r).path)).split("\n---\n");
    expect(head).toMatch(/\nsource: "auth program"\nstrategy: spawn-deep$/);
    expect(body.join("\n---\n")).not.toMatch(/^strategy:/m);
  });
});

describe("roadmap strategy default on a new save", () => {
  it("fills free on a save without it when no default is given, and the given default otherwise", () => {
    const ws = tmpWs();
    const missing = save(without(DRAFT_ROADMAP), ws);
    expect(missing.ok, missing.error).toBe(true);
    expect(read(path.join(ws, savedOk(missing).path))).toMatch(/\nsource: "auth program"\nstrategy: free\n/);

    const given = save(without(DRAFT_ROADMAP), ws, "spawn-fast");
    expect(given.ok, given.error).toBe(true);
    expect(read(path.join(ws, savedOk(given).path))).toMatch(/^strategy: spawn-fast$/m);
  });

  it("keeps a body line over the default and denies an unknown value", () => {
    const ws = tmpWs();

    const sent = save(withStrategy(DRAFT_ROADMAP, "spawn-deep"), ws, "spawn-fast");
    expect(sent.ok, sent.error).toBe(true);
    expect(read(path.join(ws, savedOk(sent).path)).match(/^strategy:.*$/gm)).toStrictEqual(["strategy: spawn-deep"]);
    const fresh = tmpWs();
    const unknown = save(withStrategy(DRAFT_ROADMAP, "review-medium"), fresh);
    expect(unknown.ok).toBe(false);
    expect(unknown.errors).toContain(NO_KEY);
    expectNothingSaved(path.join(fresh, ROADMAP_DIR));
  });
});

describe("roadmap strategy on an update", () => {
  it("keeps the key on a body-only update", () => {
    const ws = tmpWs();
    const abs = path.join(ws, savedOk(save(withStrategy(DRAFT_ROADMAP, "spawn-fast"), ws)).path);
    const body = without(DRAFT_ROADMAP).replace("strip narrating comments.", "strip narrating comments and logs.");
    const kept = update(ws, abs, body);
    expect(kept.ok, kept.error).toBe(true);
    expect(read(abs)).toMatch(/^strategy: spawn-fast$/m);
  });

  it("takes a new one, and denies a frontmatter without it", () => {
    const ws = tmpWs();
    const abs = path.join(ws, savedOk(save(withStrategy(DRAFT_ROADMAP, "spawn-fast"), ws)).path);
    const changed = update(ws, abs, withStrategy(DRAFT_ROADMAP, "free"));
    expect(changed.ok, changed.error).toBe(true);
    expect(read(abs)).toMatch(/^strategy: free$/m);
    expect(read(abs).match(/^strategy:/gm)).toHaveLength(1);
    const full = update(ws, abs, read(abs).replace(/^strategy:.*\n/m, ""));
    expect(full.ok).toBe(false);
    expect(full.errors).toContain(NO_KEY);
  });
});

describe("roadmap approval on a new save", () => {
  it("moves a body approval line into the frontmatter right after strategy and out of the body", () => {
    const ws = tmpWs();
    const r = save(withApproval(DRAFT_ROADMAP, "away"), ws);
    expect(r.ok, r.error).toBe(true);
    const [head, ...body] = read(path.join(ws, savedOk(r).path)).split("\n---\n");
    expect(head).toMatch(/\nstrategy: free\napproval: away$/);
    expect(body.join("\n---\n")).not.toMatch(/^approval:/m);
  });

  it("denies an unknown approval on a body line or in the frontmatter", () => {
    const ws = tmpWs();
    const bad = save(withApproval(DRAFT_ROADMAP, "later"), ws);
    expect(bad.ok).toBe(false);
    expect(bad.errors).toContain(APPROVAL_KEY);
    expectNothingSaved(path.join(ws, ROADMAP_DIR));
    const ok = save(DRAFT_ROADMAP, ws);
    expect(ok.ok, ok.error).toBe(true);
    const abs = path.join(ws, savedOk(ok).path);
    expect(read(abs)).not.toMatch(/^approval:/m);
    const full = update(ws, abs, withApproval(read(abs), "later"));
    expect(full.ok).toBe(false);
    expect(full.errors).toContain(APPROVAL_KEY);
  });
});

describe("roadmap approval on an update", () => {
  it("keeps a saved approval on a body-only update and takes a new one", () => {
    const ws = tmpWs();
    const r = save(withApproval(DRAFT_ROADMAP, "away"), ws);
    expect(r.ok, r.error).toBe(true);
    const abs = path.join(ws, savedOk(r).path);
    const kept = update(ws, abs, DRAFT_ROADMAP.replace(/^strategy:.*\n/m, ""));
    expect(kept.ok, kept.error).toBe(true);
    expect(read(abs)).toMatch(/^approval: away$/m);
    const changed = update(ws, abs, withApproval(DRAFT_ROADMAP, "ask"));
    expect(changed.ok, changed.error).toBe(true);
    expect(read(abs).match(/^approval:/gm)).toStrictEqual(["approval:"]);
    expect(read(abs)).toMatch(/^approval: ask$/m);
  });
});
