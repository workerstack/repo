import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { tempDir, useTempDirs } from "../sync/__fixtures__/temp-dirs.ts";
import { LEGACY_ROADMAP } from "./__fixtures__/persist-bodies.ts";
import { prepareRoadmapUpdate } from "./persist-roadmap.ts";

useTempDirs();

function tmpWs(): string {
  return fs.realpathSync(tempDir("persist-roadmap-legacy-"));
}

const FILE = "1-auth-program-20261025T180000Z.md";

function legacyFile() {
  const ws = tmpWs();
  const dir = path.join(ws, ".tmp/repo/roadmaps");
  fs.mkdirSync(dir, { recursive: true });
  const abs = path.join(dir, FILE);
  const body = LEGACY_ROADMAP.replace(/^ROADMAP_NAME:.*\n/, "").replace(/^strategy:.*\n\n?/, "");
  const head = "serial: 1\nname: auth-program\nstatus: draft\nreviews: 0\ncreated: 2026-10-25T18:00:00Z";
  fs.writeFileSync(abs, `---\n${head}\nsource: "auth program"\nstrategy: default\n---\n\n${body}`);
  return { abs, ws };
}

function legacyUpdate(edit: (text: string) => string) {
  const { ws, abs } = legacyFile();
  return prepareRoadmapUpdate({ content: edit(LEGACY_ROADMAP), filePath: abs, workspaceRoot: ws });
}

describe("legacy roadmap section rules", () => {
  it("denies sections out of order and a section outside the six", () => {
    expect(legacyUpdate((t) => t.replace("## Decisions\n", "## Notes\n")).errors).toContain("heading order");
    expect(legacyUpdate((t) => t.replace("## Verify", "## Appendix\n- x\n\n## Verify")).errors).toContain("extra h2");
  });

  it("denies a section without bullets", () => {
    expect(legacyUpdate((t) => t.replace("- Init owns reserved names", "plain prose")).errors).toContain(
      "context bullets",
    );
  });

  it("denies a slice title of one word and a slice Goal of two sentences", () => {
    const errors = legacyUpdate((t) =>
      t.replace("Title: auth types", "Title: auth").replace("Reserved names list the new skills.", "A. B."),
    ).errors;
    expect(errors).toContain("title");
    expect(errors).toContain("slice goal");
  });

  it("denies a slice Why of three sentences and a Location outside the plans dir", () => {
    const errors = legacyUpdate((t) =>
      t
        .replace("      Why: Every", "      Location: .tmp/repo/roadmaps/x.md\n      Why: Every")
        .replace("Every later land goes through commit.", "One. Two. Three."),
    ).errors;
    expect(errors).toContain("why");
    expect(errors).toContain("location");
  });
});

describe("legacy roadmap slice and frontmatter rules", () => {
  it("accepts a slice Location that is an absolute path", () => {
    const r = legacyUpdate((t) => t.replace("      Why: Every", "      Location: /abs/plan.md\n      Why: Every"));
    expect(r.ok, r.error).toBe(true);
  });

  it("denies a legacy update with no Order", () => {
    expect(legacyUpdate((t) => t.replace(/## Order\n[\s\S]*?\n\n## Watch-outs/, "## Watch-outs")).errors).toContain(
      "slices",
    );
  });

  it("reads the body-only status and reviews lines when no frontmatter is sent", () => {
    const r = legacyUpdate((t) => `status: draft\nreviews: 0\n${t}`);
    expect(r.ok, r.error).toBe(true);
    expect(r.content).toMatch(/^status: draft\nreviews: 0\ncreated/m);
  });

  it("lets the sent frontmatter beat a status and reviews line in the body", () => {
    const legacy = LEGACY_ROADMAP.replace(/^ROADMAP_NAME:.*\n/, "").replace(/^strategy:.*\n\n?/, "");
    const sent =
      "---\nserial: 1\nname: auth-program\nstatus: draft\nreviews: 0\ncreated: 2026-10-25T18:00:00Z\n" +
      `source: "auth program"\nstrategy: default\n---\n\nstatus: blocked\nreviews: 3\n${legacy}`;
    const { ws, abs } = legacyFile();
    const r = prepareRoadmapUpdate({ content: sent, filePath: abs, workspaceRoot: ws });
    expect(r.ok, r.error).toBe(true);
    expect(r.content).toMatch(/^status: draft\nreviews: 0\n/m);
    expect(r.content).not.toMatch(/blocked/);
  });
});
