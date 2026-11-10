/** Saved-roadmap helpers the roadmap save suites share. */
import fs from "node:fs";
import path from "node:path";
import { expect } from "vitest";
import { DRAFT_ROADMAP, LEGACY_ROADMAP, savedOk } from "./persist-bodies.ts";
import { persistRoadmap, prepareRoadmapUpdate } from "../persist-roadmap.ts";

export const CREATED = "2026-10-25T18:00:00Z";
export const LEGACY_FILE = "1-auth-program-20261025T180000Z.md";
/** The line a draft roadmap names itself on; frontmatter keys go in front of it. */
export const NAME_LINE = "ROADMAP_NAME: auth program\n";

/** The host side of a roadmap rewrite: validate through prepareRoadmapUpdate, then write what it returns. */
export function update(ws: string, abs: string, content: string) {
  const r = prepareRoadmapUpdate({ workspaceRoot: ws, filePath: abs, content });
  if (r.ok) fs.writeFileSync(abs, savedOk(r).content);
  return r;
}

/** The deny a fresh roadmap gets for a section that belongs in the slice plans. */
export const extra = (h: string): string =>
  `a new roadmap has only ## Order, ## Verify and ## Previous mistakes; move ## ${h} into the slice plans`;

/** A roadmap saved in the old shape before pointer roadmaps: written straight to disk, as roadmaps 1–4 are. */
export function savedLegacy(ws: string, body = LEGACY_ROADMAP, head = "status: draft\nreviews: 0"): string {
  const dir = path.join(ws, ".tmp/repo/roadmaps");
  fs.mkdirSync(dir, { recursive: true });
  const abs = path.join(dir, LEGACY_FILE);
  const rest = body.replace(/^ROADMAP_NAME:.*\n/, "").replace(/^strategy:.*\n\n?/, "");
  fs.writeFileSync(
    abs,
    `---\nserial: 1\nname: auth-program\n${head}\ncreated: 2026-10-25T18:00:00Z\nsource: "auth program"\nstrategy: default\n---\n\n${rest}`,
  );
  return abs;
}

/** Saves `content` as a new roadmap in `ws` and returns its absolute path. */
export function savedRoadmap(ws: string, content = DRAFT_ROADMAP): string {
  const r = persistRoadmap({ workspaceRoot: ws, content, created: CREATED });
  expect(r.ok, r.error).toBe(true);
  return path.join(ws, savedOk(r).path);
}
