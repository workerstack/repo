import path from "node:path";

import { describe, expect, it } from "vitest";

import { removeTree } from "../remove-tree.ts";
import { ctxOf, run, worktree } from "./__fixtures__/session-map-kit.ts";
import { fallbackNotice, header, sessionContext } from "./session-map.ts";

/** The notice an uninstalled worktree prints when its hooks run the bin of the checkout at `main`. */
function noticeFor(main: string): string {
  const bin = path.join(main, "node_modules", ".bin", "repo");

  return `repo: hooks run ${bin} (this worktree has no install); run \`bun install\` here to use its own code\n`;
}

describe("session-map hook", () => {
  describe("in a linked worktree", () => {
    it("builds the notice only for the fallback bin", () => {
      const fallback = worktree(false);
      expect(fallbackNotice(fallback.wt)).toBe(noticeFor(fallback.main));
      expect(fallbackNotice(worktree(true).wt)).toBe("");
    });

    it("puts the notice before the map, and alone when there is no map", () => {
      const map = { depth: 6, rows: 1, text: "src/\n", tokens: 1 };
      expect(sessionContext("note\n", map)).toBe(`note\n${header(null)}\nsrc/\n`);
      expect(sessionContext("note\n", { ...map, text: "a/  …\n" })).toBe(`note\n${header(6)}\na/  …\n`);
      expect(sessionContext("note\n", null)).toBe("note\n");
      expect(sessionContext("", { ...map, text: "" })).toBe("");
    });
  });
});

describe("session-map hook", () => {
  describe("in a linked worktree", () => {
    it("says once which bin runs when the worktree has no install", () => {
      const { main, wt } = worktree(false);
      const r = run(wt, JSON.stringify({ cwd: wt, session_id: "s-wt" }));
      expect(r.status).toBe(0);
      const ctx = ctxOf(r.stdout);
      expect(ctx.startsWith(noticeFor(main))).toBe(true);
      expect(ctx.split("hooks run").length).toBe(2);
      expect(ctx).toContain("Folder map (");
    });

    it("stays quiet when the worktree has its own install", () => {
      const { wt } = worktree(true);
      const ctx = ctxOf(run(wt, JSON.stringify({ cwd: wt, session_id: "s-own" })).stdout);
      expect(ctx).not.toContain("hooks run");
      expect(ctx.startsWith("Folder map (")).toBe(true);
    });

    it("still says it when the map is empty", () => {
      const { wt } = worktree(false);
      removeTree(path.join(wt, "src"));
      const ctx = ctxOf(run(wt, JSON.stringify({ cwd: wt, session_id: "s-empty" })).stdout);
      expect(ctx).toContain("(this worktree has no install)");
      expect(ctx).not.toContain("Folder map (");
    });
  });
});
