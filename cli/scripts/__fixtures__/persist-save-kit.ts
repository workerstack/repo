/** Shared save tests for the doc kinds that stamp a serial file: handoffs, journals and tmp notes. */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { PersistResult } from "../persist-doc.ts";

type SaveInput = { content?: string; created?: string; source?: string; workspaceRoot?: string };
type Saved = PersistResult<{ content: string; filename: string }>;

/** One doc kind: its save function, its folder, a valid body, and the slug and stamp that body saves under. */
export type SaveKit = {
  label: string;
  save: (input?: SaveInput) => Saved;
  dir: string;
  body: string;
  slug: string;
  created: string;
  tmpWs: () => string;
};

/** Saves `body` with no workspace from a git repo the working directory points at; returns that root. */
export function saveAtRepoRoot(kit: Pick<SaveKit, "body" | "dir" | "save" | "tmpWs">): string {
  const root = kit.tmpWs();
  execFileSync("git", ["init", "-q"], { cwd: root });
  vi.stubEnv("GROK_WORKSPACE_ROOT", "");
  vi.stubEnv("CLAUDE_PROJECT_DIR", "");
  vi.spyOn(process, "cwd").mockReturnValue(root);
  const saved = kit.save({ content: kit.body });
  expect(saved.ok, saved.error).toBe(true);
  expect(fs.readdirSync(path.join(root, kit.dir))).toStrictEqual([saved.filename]);
  return root;
}

/** Puts a plan with serial 9 in `ws`, so a save can show it does not count plan serials. */
export function seedOtherPlan(ws: string): void {
  fs.mkdirSync(path.join(ws, ".repo/plans"), { recursive: true });
  fs.writeFileSync(path.join(ws, ".repo/plans/9-other-20260826T143000Z.md"), "x");
}

/** `dir` exists and holds nothing: the save made its folder and wrote no file. */
export function expectNothingSaved(dir: string): void {
  expect(fs.existsSync(dir)).toBe(true);
  expect(fs.readdirSync(dir)).toStrictEqual([]);
}

function stampOf(created: string): string {
  return created.replaceAll("-", "").replaceAll(":", "");
}

/** Registers the source, stamp and refusal tests every stamped doc kind shares. */
export function describeSourceAndRefusals(kit: SaveKit): void {
  const { body, created, label, save, slug, tmpWs } = kit;
  describe(`${label} source and stamp`, () => {
    it("keeps a source the caller gives, cut to 120 characters", () => {
      const r = save({ content: body, source: "s".repeat(200), workspaceRoot: tmpWs() });
      expect(r.content).toContain(`source: "${"s".repeat(120)}"`);
    });

    it("stamps now when created is not a UTC datetime", () => {
      const day = created.slice(0, 10);
      const r = save({ content: body, created: day, workspaceRoot: tmpWs() });
      expect(r.filename).toMatch(new RegExp(`^1-${slug}-\\d{8}T\\d{6}Z\\.md$`));
      expect(r.filename).not.toContain(`${stampOf(day)}T`);
    });
  });

  describe(`${label} refusals`, () => {
    it("refuses a body with no sections", () => {
      const r = save({ content: "just words\n", workspaceRoot: tmpWs() });
      expect(r.ok).toBe(false);
      expect(r.error).toContain("heading order");
    });

    it("refuses a body with an open fence before it creates the directory", () => {
      const ws = tmpWs();
      const r = save({ content: `${body}\n\`\`\`md\n`, workspaceRoot: ws });
      expect(r.ok).toBe(false);
      expect(r.errors?.length).toBeGreaterThan(0);
      expect(fs.existsSync(path.join(ws, ".tmp"))).toBe(false);
    });
  });
}

/** Registers the serial collision and overflow tests every stamped doc kind shares. */
export function describeSerialLimits(kit: SaveKit): void {
  const { body, created, dir, label, save, slug, tmpWs } = kit;
  const stamp = stampOf(created);
  function seeded(name: string): { ws: string; abs: string } {
    const ws = tmpWs();
    const abs = path.join(ws, dir);
    fs.mkdirSync(abs, { recursive: true });
    fs.writeFileSync(path.join(abs, name), "x");
    return { abs, ws };
  }
  describe(`${label} serial limits`, () => {
    it("reports a serial collision when the next name is already taken", () => {
      // A serial past 2**53 cannot count up: the next serial is the one already on disk.
      const taken = `100000000000000000000-${slug}-${stamp}.md`;
      const { abs, ws } = seeded(taken);
      const r = save({ content: body, created, workspaceRoot: ws });
      expect(r).toStrictEqual({ error: "serial collision", ok: false });
      expect(fs.readdirSync(abs)).toStrictEqual([taken]);
    });

    it("refuses a serial that no longer prints as digits", () => {
      const { abs, ws } = seeded(`${"1".padEnd(22, "0")}-old-${stamp}.md`);
      const r = save({ content: body, created, workspaceRoot: ws });
      expect(r.ok).toBe(false);
      expect(r.error).toContain("filename");
      expect(fs.readdirSync(abs)).toHaveLength(1);
    });
  });
}
