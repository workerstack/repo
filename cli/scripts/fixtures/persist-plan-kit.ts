/** Temp workspaces, saved-plan helpers and the lean-format card pieces the plan save suites share. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect } from "vitest";
import { VALID_PLAN, savedOk } from "./persist-bodies.ts";
import { persistPlan, preparePlanUpdate } from "../persist-plan.ts";

export const CREATED = "2026-08-26T14:30:00Z";
export const read = (p: string): string => fs.readFileSync(p, "utf8");

/** A maker of temp workspaces for one suite; each is removed after the test that made it. */
export function useTmpWs(prefix = "persist-plan-"): () => string {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });
  return () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    dirs.push(dir);
    return dir;
  };
}

/** The host side of a plan rewrite: validate through preparePlanUpdate, then write what it returns. */
export function update(ws: string, abs: string, content: string) {
  const r = preparePlanUpdate({ workspaceRoot: ws, filePath: abs, content });
  if (r.ok) fs.writeFileSync(abs, savedOk(r).content);
  return r;
}

/** `text` with its Previous mistakes section replaced by `entries`. */
export const withEntries = (text: string, ...entries: string[]): string =>
  text.replace(/## Previous mistakes\n[\s\S]*$/, `## Previous mistakes\n${entries.join("\n")}\n`);

export const CARD = [
  "WHAT   .gitignore ignores .tmp/",
  "WHY    plans stay untracked",
  "RISK   other ignore lines must survive",
  "TOUCH  .gitignore",
  "DONE   git check-ignore reports .tmp/repo/plans",
] as const;
export const H1 = "# add-tmp-ignore\n\n";
export const stripCard = (t: string): string =>
  t.replace(/(# add-tmp-ignore\n\n)(?:(?:WHAT|WHY|RISK|TOUCH|DONE) .*\n)+\n/, "$1");
export const withCard = (t: string, card: readonly string[]): string =>
  stripCard(t).replace(H1, `${H1}${card.join("\n")}\n\n`);
export const CARDED: string = withCard(VALID_PLAN, CARD);
/** The 0-based line of Previous mistakes: the lines above it. */
export const above = (t: string): number => t.split("\n").indexOf("## Previous mistakes");
export const pad = (t: string, n: number): string =>
  t.replace("## Context\n", `## Context\n${Array.from({ length: n }, (_, i) => `- filler ${i}\n`).join("")}`);
export const withSteps = (t: string, steps: string[], verify: string[]): string =>
  t.replace(
    /## Steps\n[\s\S]*?(?=## Previous mistakes)/,
    `## Steps\n${steps.join("\n")}\n\n## Verify\n${verify.join("\n")}\n\n`,
  );

/** The save/saved/legacy helpers of the lean-format suites, bound to one workspace maker. */
export function leanKit(tmpWs: () => string) {
  const save = (content: string, ws = tmpWs()) => persistPlan({ workspaceRoot: ws, content, created: CREATED });
  function saved(content = CARDED) {
    const ws = tmpWs();
    const r = save(content, ws);
    expect(r.ok, r.error).toBe(true);
    return { ws, abs: path.join(ws, savedOk(r).path) };
  }
  // A saved plan whose file was written before these rules: whatever is on disk is the previous version.
  function legacy(text: (saved: string) => string) {
    const s = saved();
    fs.writeFileSync(s.abs, text(read(s.abs)));
    return s;
  }
  return { save, saved, legacy };
}
