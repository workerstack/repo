import fs from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { useTempDirs } from "../__fixtures__/temp-dirs.ts";
import { DRAFT_ROADMAP, LEGACY_ROADMAP } from "./__fixtures__/persist-bodies.ts";
import { locationOk } from "./persist-roadmap-shape.ts";
import { persistRoadmap, prepareRoadmapUpdate } from "./persist-roadmap.ts";

const { tempDir } = useTempDirs("persist-roadmap-edges-");

function tmpWs(): string {
  return fs.realpathSync(tempDir());
}

const CREATED = "2026-10-25T18:00:00Z";
const FILE = "1-auth-program-20261025T180000Z.md";

/** The path of the saved roadmap in `ws`, its folder made. */
function roadmapFile(ws: string): string {
  const dir = path.join(ws, ".tmp/repo/roadmaps");
  fs.mkdirSync(dir, { recursive: true });

  return path.join(dir, FILE);
}

describe("roadmap names", () => {
  it("names a roadmap from its title when ROADMAP_NAME is absent", () => {
    const content = DRAFT_ROADMAP.replace(/^ROADMAP_NAME: .*\n/, "");
    const r = persistRoadmap({ content, created: CREATED, workspaceRoot: tmpWs() });
    expect(r.ok, r.error).toBe(true);
    expect(r.filename).toBe(FILE);
  });

  it("gives an untitled roadmap its slug as the title and denies it for missing slices", () => {
    const r = persistRoadmap({ content: "just words", created: CREATED, workspaceRoot: tmpWs() });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("slices");
  });

  it("titles a save that has a name but no title line", () => {
    const content = DRAFT_ROADMAP.replace("# auth-program\n", "");
    const r = persistRoadmap({ content, created: CREATED, workspaceRoot: tmpWs() });
    expect(r.ok, r.error).toBe(true);
    expect(r.content).toContain("\n---\n\n# auth-program\n\nWHAT");
  });
});

describe("roadmap source", () => {
  it("takes the source from the Goal when the saved file has none and the update has no name or title", () => {
    const ws = tmpWs();
    const abs = roadmapFile(ws);
    fs.writeFileSync(
      abs,
      `---\nserial: 1\nname: auth-program\nstatus: draft\ncreated: ${CREATED}\n` +
        `strategy: default\n---\n\n${LEGACY_ROADMAP}`,
    );
    const content = LEGACY_ROADMAP.replace(/^ROADMAP_NAME:.*\n/, "").replace("# auth-program\n\n", "");
    const r = prepareRoadmapUpdate({ content, filePath: abs, workspaceRoot: ws });
    expect(r.ok, r.error).toBe(true);
    expect(r.content).toContain(
      'source: "Ship auth as two plans. The second plan waits on the first. Names stay reserved."',
    );
  });
});

describe("roadmap serials and empty saves", () => {
  it("skips non-serial names when numbering and never overwrites a counted file", () => {
    const ws = tmpWs();
    const dir = path.join(ws, ".tmp/repo/roadmaps");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "notes.md"), "n");
    fs.writeFileSync(path.join(dir, "7-old-20260101T000000Z.md"), "old");
    const r = persistRoadmap({ content: DRAFT_ROADMAP, created: CREATED, workspaceRoot: ws });
    expect(r.serial).toBe(8);
    expect(fs.readFileSync(path.join(dir, "7-old-20260101T000000Z.md"), "utf8")).toBe("old");
  });

  it("denies a save with no content", () => {
    const ws = tmpWs();
    expect(persistRoadmap({ workspaceRoot: ws }).ok).toBe(false);
    expect(fs.readdirSync(path.join(ws, ".tmp/repo/roadmaps"))).toStrictEqual([]);
  });

  it("denies an unclosed fence in a save and in an update", () => {
    const ws = tmpWs();
    const bad = "```\nopen\n";
    expect(persistRoadmap({ content: bad, workspaceRoot: ws }).errors).toStrictEqual([
      "unclosed code fence at line 1: close it with the same fence",
    ]);
    const first = persistRoadmap({ content: DRAFT_ROADMAP, created: CREATED, workspaceRoot: ws });
    const r = prepareRoadmapUpdate({ content: bad, filePath: path.join(ws, String(first.path)), workspaceRoot: ws });
    expect(r.errors).toStrictEqual(["unclosed code fence at line 1: close it with the same fence"]);
  });
});

describe("roadmap update fallbacks", () => {
  it("denies an update with no content", () => {
    const ws = tmpWs();
    const first = persistRoadmap({ content: DRAFT_ROADMAP, created: CREATED, workspaceRoot: ws });
    const r = prepareRoadmapUpdate({ filePath: path.join(ws, String(first.path)), workspaceRoot: ws });
    expect(r.ok).toBe(false);
  });

  it("falls back to now and a draft status for a saved file with no created or status", () => {
    const ws = tmpWs();
    const abs = roadmapFile(ws);
    fs.writeFileSync(abs, "---\nserial: 1\nname: auth-program\n---\n\n# auth-program\n");
    const r = prepareRoadmapUpdate({ content: DRAFT_ROADMAP, filePath: abs, workspaceRoot: ws });
    expect(r.ok, r.error).toBe(true);
    expect(r.content).toMatch(/^status: draft\n/m);
    expect(r.content).toMatch(/^created: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/m);
    expect(r.content).toContain('source: "auth program"');
  });
});

describe("roadmap root and locations", () => {
  it("reads the root from the environment when no workspace is passed", () => {
    const ws = tmpWs();
    vi.stubEnv("CLAUDE_PROJECT_DIR", ws);
    vi.stubEnv("GROK_WORKSPACE_ROOT", ws);
    const first = persistRoadmap({ content: DRAFT_ROADMAP, created: CREATED });
    expect(fs.existsSync(path.join(ws, String(first.path)))).toBe(true);
    expect(persistRoadmap().ok).toBe(false);
    const r = prepareRoadmapUpdate({ content: DRAFT_ROADMAP, filePath: String(first.path) });
    expect(r.ok, r.error).toBe(true);
  });

  it("denies an empty Location", () => {
    expect(locationOk("")).toBe(false);
  });
});
