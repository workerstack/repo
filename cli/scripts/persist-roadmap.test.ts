import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DRAFT_ROADMAP, savedOk } from "./fixtures/persist-bodies.ts";
import { read, useTmpWs } from "./fixtures/persist-plan-kit.ts";
import { CREATED, update } from "./fixtures/persist-roadmap-kit.ts";
import { persistRoadmap, prepareRoadmapUpdate } from "./persist-roadmap.ts";

const tmpWs = useTmpWs("persist-roadmap-");
const ROADMAPS = ".tmp/repo/roadmaps";
const SLICE_2 = "2 [ ] commit diff pass: Commit skills strip narrating comments.\n";
const LOGS = (t: string) => t.replace("strip narrating comments.", "strip narrating comments and logs.");

describe("persistRoadmap", () => {
  it("persists a two-slice pointer draft with no Location at serial 1", () => {
    const ws = tmpWs();
    const r = persistRoadmap({ workspaceRoot: ws, content: DRAFT_ROADMAP, created: CREATED });
    expect(r.ok).toBe(true);
    expect(r.serial).toBe(1);
    expect(r.path).toBe(".tmp/repo/roadmaps/1-auth-program-20261025T180000Z.md");
    const text = read(path.join(ws, savedOk(r).path));
    expect(text).toMatch(/^status: draft$/m);
    expect(text).not.toMatch(/^\s+Location:/m);
    expect(text).toMatch(/^1 \[ \] auth types: Reserved names list the new skills\.$/m);
    expect(text).toMatch(/^2 \[ \] commit diff pass: Commit skills strip narrating comments\.$/m);
  });

  it("rejects a one-slice roadmap", () => {
    const ws = tmpWs();
    const r = persistRoadmap({ workspaceRoot: ws, content: DRAFT_ROADMAP.replace(SLICE_2, "") });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("slices");
    expect(fs.existsSync(path.join(ws, ROADMAPS))).toBe(true);
    expect(fs.readdirSync(path.join(ws, ROADMAPS))).toEqual([]);
  });
});

describe("persistRoadmap and the ignore file", () => {
  it("never touches .gitignore", () => {
    const ws = tmpWs();
    persistRoadmap({ workspaceRoot: ws, content: DRAFT_ROADMAP });
    expect(fs.existsSync(path.join(ws, ".gitignore"))).toBe(false);
    const kept = tmpWs();
    fs.writeFileSync(path.join(kept, ".gitignore"), "node_modules\n");
    persistRoadmap({ workspaceRoot: kept, content: DRAFT_ROADMAP });
    persistRoadmap({ workspaceRoot: kept, content: DRAFT_ROADMAP });
    expect(read(path.join(kept, ".gitignore"))).toBe("node_modules\n");
  });
});

describe("a rewrite of the same roadmap file", () => {
  it("keeps the serial when the same file is written again", () => {
    const ws = tmpWs();
    const first = persistRoadmap({ workspaceRoot: ws, content: DRAFT_ROADMAP, created: CREATED });
    expect(first.ok).toBe(true);
    const again = update(ws, path.join(ws, savedOk(first).path), LOGS(String(first.content)));
    expect(again.ok).toBe(true);
    expect(again.serial).toBe(1);
    expect(again.path).toBe(first.path);
    expect(fs.readdirSync(path.join(ws, ROADMAPS))).toEqual(["1-auth-program-20261025T180000Z.md"]);
    expect(read(path.join(ws, savedOk(again).path))).toMatch(/comments and logs\./);
  });
});

describe("prepareRoadmapUpdate", () => {
  it("validates a rewrite of a saved roadmap without writing it", () => {
    const ws = tmpWs();
    const first = persistRoadmap({ workspaceRoot: ws, content: DRAFT_ROADMAP, created: CREATED });
    const abs = path.join(ws, savedOk(first).path);
    const before = read(abs);
    const r = prepareRoadmapUpdate({ workspaceRoot: ws, filePath: abs, content: LOGS(DRAFT_ROADMAP) });
    expect(r.ok, r.error).toBe(true);
    expect(r.serial).toBe(1);
    expect(r.path).toBe(first.path);
    expect(r.content).toMatch(/^serial: 1$/m);
    expect(r.content).toMatch(/comments and logs\./);
    // The host writes it: a hook write first makes Claude Code refuse the Write as modified since read.
    expect(read(abs)).toBe(before);
  });

  it("denies a rewrite that breaks the heading order", () => {
    const ws = tmpWs();
    const first = persistRoadmap({ workspaceRoot: ws, content: DRAFT_ROADMAP, created: CREATED });
    const abs = path.join(ws, savedOk(first).path);
    const content = DRAFT_ROADMAP.replace("## Order", "## Aim");
    expect(prepareRoadmapUpdate({ workspaceRoot: ws, filePath: abs, content }).ok).toBe(false);
  });
});
