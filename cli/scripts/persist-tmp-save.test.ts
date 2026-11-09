import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VALID_TMP } from "./fixtures/persist-bodies.ts";
import { TMP_DIR, persistTmp } from "./persist-tmp.ts";

const tmpDirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function tmpWs() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "persist-tmp-s-")));
  tmpDirs.push(dir);
  return dir;
}

const CREATED = "2026-08-27T14:30:00Z";
const STAMP = "20260827T143000Z";

describe("persistTmp serials", () => {
  it("steps past a taken name and keeps counting from the files it can see", () => {
    const ws = tmpWs();
    const dir = path.join(ws, TMP_DIR);
    // A folder holding the next name hides from the serial scan but still blocks the write.
    fs.mkdirSync(path.join(dir, `1-bank-email-draft-${STAMP}.md`), { recursive: true });
    fs.mkdirSync(path.join(dir, `2-bank-email-draft-${STAMP}.md`));
    const r = persistTmp({ workspaceRoot: ws, content: VALID_TMP, created: CREATED });
    expect(r.ok, r.error).toBe(true);
    expect(r.serial).toBe(3);
    expect(r.filename).toBe(`3-bank-email-draft-${STAMP}.md`);
    expect(fs.readFileSync(path.join(dir, r.filename ?? ""), "utf8")).toContain("Subject: hello");
  });

  it("gives up with a serial collision once five names in a row are taken", () => {
    const ws = tmpWs();
    const dir = path.join(ws, TMP_DIR);
    for (let n = 1; n <= 6; n++) fs.mkdirSync(path.join(dir, `${n}-bank-email-draft-${STAMP}.md`), { recursive: true });
    const r = persistTmp({ workspaceRoot: ws, content: VALID_TMP, created: CREATED });
    expect(r).toEqual({ ok: false, error: "serial collision" });
    expect(fs.readdirSync(dir).filter((n) => fs.statSync(path.join(dir, n)).isFile())).toEqual([]);
  });

  it("skips a file with no number in front when counting", () => {
    const ws = tmpWs();
    const dir = path.join(ws, TMP_DIR);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "no-number.md"), "x");
    const r = persistTmp({ workspaceRoot: ws, content: VALID_TMP, created: CREATED });
    expect(r.serial).toBe(1);
  });
});

describe("persistTmp serial limits", () => {
  it("refuses a serial that no longer prints as digits", () => {
    const ws = tmpWs();
    const dir = path.join(ws, TMP_DIR);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${"1".padEnd(22, "0")}-old-${STAMP}.md`), "x");
    const r = persistTmp({ workspaceRoot: ws, content: VALID_TMP, created: CREATED });
    expect(r).toEqual({ ok: false, error: "filename" });
    expect(fs.readdirSync(dir)).toHaveLength(1);
  });
});

describe("persistTmp stamp and root", () => {
  it("stamps now when created is not a UTC datetime", () => {
    const r = persistTmp({ workspaceRoot: tmpWs(), content: VALID_TMP, created: "2026-08-27" });
    expect(r.filename).toMatch(/^1-bank-email-draft-\d{8}T\d{6}Z\.md$/);
    expect(r.filename).not.toContain("20260827T");
  });

  it("saves under the repo root of the working directory when no workspace is given", () => {
    const root = tmpWs();
    execFileSync("git", ["init", "-q"], { cwd: root });
    vi.stubEnv("GROK_WORKSPACE_ROOT", "");
    vi.stubEnv("CLAUDE_PROJECT_DIR", "");
    vi.spyOn(process, "cwd").mockReturnValue(root);
    const saved = persistTmp({ content: VALID_TMP });
    expect(saved.ok, saved.error).toBe(true);
    expect(fs.readdirSync(path.join(root, TMP_DIR))).toEqual([saved.filename]);
    expect(persistTmp()).toEqual({ ok: false, error: "missing TMP_NAME" });
  });
});
