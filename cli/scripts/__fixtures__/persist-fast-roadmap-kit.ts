/** Bodies and helpers the fast roadmap save suites share. */
import fs from "node:fs";
import path from "node:path";
import { expect } from "vitest";

import { savedOk } from "./persist-bodies.ts";
import { persistFastRoadmap, prepareFastRoadmapUpdate } from "../persist-fast-roadmap.ts";

export const CREATED = "2026-11-13T04:00:00Z";
export const NAME = "1-tidy-ignores-20261113T040000Z.md";
export const PLAN_ABS = "/repo/.repo/plans-fast/4-add-tmp-ignore-20261113T030000Z.md";
export const NO_LOCATION = "a fast roadmap slice's Location is a fast plan under .repo/plans-fast/";

export const BODY = [
  "# anything",
  "",
  "## Order",
  "1 [ ] ignore tmp: add .tmp/ to .gitignore",
  "2 [ ] ignore logs: add *.log to .gitignore",
  "",
  "## Verify",
  "3 [ ] `git check-ignore .tmp/x a.log` prints both",
  "",
].join("\n");

export const SENT = `FAST_ROADMAP_NAME: tidy ignores\n${BODY}`;

export function saveRoadmap(content: string, workspaceRoot: string) {
  return persistFastRoadmap({ content, created: CREATED, workspaceRoot });
}

/** Saves the Usage roadmap into `ws`: its file, its saved result and the workspace. */
export function savedRoadmap(ws: string) {
  const r = saveRoadmap(SENT, ws);
  expect(r.ok, r.error).toBe(true);

  return { abs: path.join(ws, savedOk(r).path), r: savedOk(r), ws };
}

/** The host side of an update: validate, then write what comes back. */
export function updateRoadmap(ws: string, abs: string, content: string) {
  const r = prepareFastRoadmapUpdate({ content, filePath: abs, workspaceRoot: ws });

  if (r.ok) fs.writeFileSync(abs, r.content);

  return r;
}

/** The Usage body with `n` more flat Verify lines. */
export function withExtraBoxes(n: number): string {
  const boxes = Array.from({ length: n }, (_, i) => `${i + 10} [ ] f`).join("\n");

  return SENT.replace("3 [ ]", `${boxes}\n3 [ ]`);
}

/** `text` with a Location line under slice 1. */
export function withLocation(text: string, loc: string): string {
  return text.replace("1 [ ] ignore tmp: add .tmp/ to .gitignore", `$&\n      Location: ${loc}`);
}
