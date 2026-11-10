import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fwd } from "../../dev/test-paths";
import {
  patchOfCommand,
  pathIsDenied,
  recordWrote,
  rewritePatch,
  rewriteScratchPath,
  rewriteScratchWrite,
  wasWroteThisSession,
  wroteListPath,
} from "./gate-fat-tools.ts";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function plant() {
  const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gate-paths-")));
  tmpDirs.push(ws);
  return { ws, roots: { root: ws, checkout: ws, cwd: ws } };
}

const STOCK_DIR = ["pkg", "node_modules", "@workerstack", "repo", "references"].join("/");

describe("pathIsDenied edges", () => {
  it("allows nothing-paths and stock references, denies a lockfile reached through a dot segment", () => {
    expect(pathIsDenied(null)).toBe(false);
    expect(pathIsDenied("  ")).toBe(false);
    expect(pathIsDenied(`${STOCK_DIR}/plan-format.md`)).toBe(false);
    expect(pathIsDenied("bun.lock/.")).toBe(true);
    expect(pathIsDenied(`${STOCK_DIR}/../cli/a.ts`)).toBe(true);
  });
});

describe("scratch rewrites", () => {
  it("answers null for a missing path or missing roots", () => {
    const { roots } = plant();
    expect(rewriteScratchPath(null, roots)).toBeNull();
    expect(rewriteScratchPath("", roots)).toBeNull();
    expect(rewriteScratchPath(".tmp/repo/a.md", null)).toBeNull();
    expect(rewriteScratchWrite(5, roots)).toBeNull();
    expect(rewriteScratchWrite("notes.md", null)).toBeNull();
    expect(rewriteScratchWrite("notes.md", undefined)).toBeNull();
  });

  it("refuses a scratch path that lands on another drive", () => {
    const win = { root: "C:\\ws", checkout: "C:\\ws", cwd: "C:\\ws" };
    expect(rewriteScratchPath(".tmp/repo/D:/x", win, path.win32)).toBeNull();
    expect(rewriteScratchPath("sub\\.tmp\\repo\\a.md", win, path.win32)).toBe("C:\\ws\\.tmp\\repo\\a.md");
  });

  it("moves a stray scratch name to the root scratch dir", () => {
    const { ws, roots } = plant();
    expect(rewriteScratchWrite("notes.md", roots)).toBe(path.join(ws, ".tmp", "repo", "notes.md"));
    expect(rewriteScratchWrite("src/notes.md", roots)).toBeNull();
  });
});

describe("the session write list", () => {
  it("names no list without a root or a session", () => {
    expect(wroteListPath("", "s1")).toBe("");
    expect(wroteListPath("/ws", "")).toBe("");
    expect(wroteListPath("/ws", "s1")).toBe(path.join("/ws", ".tmp", "repo", "sessions", "s1", "wrote.txt"));
  });
});

describe("the session write list, recording", () => {
  it("records once, answers per session, and ignores empty arguments", () => {
    const { ws, roots } = plant();
    const file = path.join(ws, "src", "a.ts");
    recordWrote(null, "s1", file);
    recordWrote(roots, "", file);
    recordWrote(roots, "s1", "");
    expect(fs.existsSync(path.join(ws, ".tmp"))).toBe(false);
    recordWrote(roots, "s1", file);
    recordWrote(roots, "s1", file);
    expect(fs.readFileSync(wroteListPath(ws, "s1"), "utf8")).toBe(`${fwd(file)}\n`);
    expect(wasWroteThisSession(roots, "s1", file)).toBe(true);
    expect(wasWroteThisSession(roots, "s2", file)).toBe(false);
    expect(wasWroteThisSession(null, "s1", file)).toBe(false);
    expect(wasWroteThisSession(roots, "", file)).toBe(false);
    expect(wasWroteThisSession(roots, "s1", "")).toBe(false);
    expect(wasWroteThisSession(roots, "s1", path.join(ws, "other.ts"))).toBe(false);
  });

  it("does not record a file outside the root and checkout", () => {
    const { ws, roots } = plant();
    recordWrote(roots, "s1", path.join(os.tmpdir(), "elsewhere-gate-paths.ts"));
    expect(fs.existsSync(wroteListPath(ws, "s1"))).toBe(false);
  });

  it("gives up quietly when the session dir cannot be made", () => {
    const { ws, roots } = plant();
    fs.writeFileSync(path.join(ws, ".tmp"), "a file where the dir goes");
    expect(() => recordWrote(roots, "s1", path.join(ws, "a.ts"))).not.toThrow();
    expect(wasWroteThisSession(roots, "s1", path.join(ws, "a.ts"))).toBe(false);
  });
});

describe("patches", () => {
  it("reads no patch from an empty command", () => {
    expect(patchOfCommand(undefined)).toBeNull();
    expect(patchOfCommand("")).toBeNull();
    expect(patchOfCommand("apply_patch <<'EOF'\n*** Add File: a\nEOF")).toBe("*** Add File: a");
  });

  it("lists every final path but a deleted one", () => {
    const { ws, roots } = plant();
    const out = rewritePatch("*** Delete File: gone.ts\n*** Add File: notes.md\n*** Update File: src/a.ts", roots);
    const scratch = path.join(ws, ".tmp", "repo", "notes.md");
    expect(out.paths).toEqual([scratch, path.join(ws, "src", "a.ts")]);
    expect(out.patch).toContain(`*** Add File: ${scratch}`);
    expect(out.patch).toContain("*** Delete File: gone.ts");
  });
});
