import fs from "node:fs";
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

/** `body` with a `strategy:` line after its name line: the update path still reads one. */
function withStrategy(body: string, value: string) {
  return body.replace(/^ROADMAP_NAME:.*$/m, (l) => `${l}\nstrategy: ${value}`);
}

function withApproval(body: string, value: string) {
  return body.replace(/^(?:strategy:|ROADMAP_NAME:).*$/m, (l) => `${l}\napproval: ${value}`);
}

function save(content: string, ws = tmpWs(), strategy: Strategy = "free") {
  return persistRoadmap({ content, created: CREATED, strategy, workspaceRoot: ws });
}

describe("roadmap strategy on a new save", () => {
  it("writes the strategy it is given into the frontmatter after source and none in the body", () => {
    const ws = tmpWs();
    const r = save(DRAFT_ROADMAP, ws, "spawn-deep");
    expect(r.ok, r.error).toBe(true);
    const [head, ...body] = read(path.join(ws, savedOk(r).path)).split("\n---\n");
    expect(head).toMatch(/\nsource: "auth program"\nstrategy: spawn-deep$/);
    expect(body.join("\n---\n")).not.toMatch(/^strategy:/m);
  });

  it.each(["free", "spawn-fast", "spawn-deep"] as const)("takes %s as given", (strategy) => {
    const ws = tmpWs();
    const r = save(DRAFT_ROADMAP, ws, strategy);
    expect(r.ok, r.error).toBe(true);
    expect(read(path.join(ws, savedOk(r).path))).toMatch(new RegExp(`^strategy: ${strategy}$`, "m"));
  });
});

describe("roadmap strategy on an update", () => {
  it("refuses an update of a legacy roadmap saved with no strategy, and writes no strategy line", () => {
    const ws = tmpWs();
    const abs = path.join(ws, savedOk(save(DRAFT_ROADMAP, ws)).path);
    fs.writeFileSync(abs, read(abs).replace(/^strategy:.*\n/m, ""));
    const before = read(abs);
    const r = update(ws, abs, before.replace("strip narrating comments.", "strip narrating comments and logs."));
    expect(r.ok).toBe(false);
    expect(r.errors).toContain(NO_KEY);
    expect(read(abs)).toBe(before);
  });
});

describe("roadmap strategy kept on an update", () => {
  it("keeps the key on a body-only update", () => {
    const ws = tmpWs();
    const abs = path.join(ws, savedOk(save(DRAFT_ROADMAP, ws, "spawn-fast")).path);
    const body = DRAFT_ROADMAP.replace("strip narrating comments.", "strip narrating comments and logs.");
    const kept = update(ws, abs, body);
    expect(kept.ok, kept.error).toBe(true);
    expect(read(abs)).toMatch(/^strategy: spawn-fast$/m);
  });

  it("takes a new one, and keeps the saved one when a frontmatter omits it", () => {
    const ws = tmpWs();
    const abs = path.join(ws, savedOk(save(DRAFT_ROADMAP, ws, "spawn-fast")).path);
    const changed = update(ws, abs, withStrategy(DRAFT_ROADMAP, "free"));
    expect(changed.ok, changed.error).toBe(true);
    expect(read(abs)).toMatch(/^strategy: free$/m);
    expect(read(abs).match(/^strategy:/gm)).toHaveLength(1);
    const full = update(ws, abs, read(abs).replace(/^strategy:.*\n/m, ""));
    expect(full.ok, full.error).toBe(true);
    expect(read(abs)).toMatch(/^strategy: free$/m);
    const bad = update(ws, abs, withStrategy(DRAFT_ROADMAP, "review-medium"));
    expect(bad.ok).toBe(false);
    expect(bad.errors).toContain(NO_KEY);
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
    const kept = update(ws, abs, DRAFT_ROADMAP);
    expect(kept.ok, kept.error).toBe(true);
    expect(read(abs)).toMatch(/^approval: away$/m);
    const changed = update(ws, abs, withApproval(DRAFT_ROADMAP, "ask"));
    expect(changed.ok, changed.error).toBe(true);
    expect(read(abs).match(/^approval:/gm)).toStrictEqual(["approval:"]);
    expect(read(abs)).toMatch(/^approval: ask$/m);
  });
});
