import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { useTempDirs } from "../__fixtures__/temp-dirs.ts";
import { REPO, SCRATCH, repoPath } from "../repo-dirs.ts";
import { VALID_TMP } from "./__fixtures__/persist-bodies.ts";
import { saveAtRepoRoot } from "./__fixtures__/persist-save-kit.ts";
import { persistTmp } from "./persist-tmp.ts";

const { tempDir } = useTempDirs("persist-tmp-s-");

function tmpWs(): string {
  return fs.realpathSync(tempDir());
}

const CREATED = "2026-08-27T14:30:00Z";
const STAMP = "20260827T143000Z";

describe("persistTmp serials", () => {
  it("steps past a taken name and keeps counting from the files it can see", () => {
    const ws = tmpWs();
    const dir = repoPath(ws, SCRATCH);
    // A folder holding the next name hides from the serial scan but still blocks the write.
    fs.mkdirSync(path.join(dir, `1-bank-email-draft-${STAMP}.md`), { recursive: true });
    fs.mkdirSync(path.join(dir, `2-bank-email-draft-${STAMP}.md`));
    const r = persistTmp({ content: VALID_TMP, created: CREATED, workspaceRoot: ws });
    expect(r.ok, r.error).toBe(true);
    expect(r.serial).toBe(3);
    expect(r.filename).toBe(`3-bank-email-draft-${STAMP}.md`);
    expect(fs.readFileSync(path.join(dir, r.filename ?? ""), "utf8")).toContain("Subject: hello");
  });

  it("gives up with a serial collision once five names in a row are taken", () => {
    const ws = tmpWs();
    const dir = repoPath(ws, SCRATCH);

    for (let n = 1; n <= 6; n++) fs.mkdirSync(path.join(dir, `${n}-bank-email-draft-${STAMP}.md`), { recursive: true });
    const r = persistTmp({ content: VALID_TMP, created: CREATED, workspaceRoot: ws });
    expect(r).toStrictEqual({ error: "serial collision", ok: false });
    expect(fs.readdirSync(dir).filter((n) => fs.statSync(path.join(dir, n)).isFile())).toStrictEqual([]);
  });

  it("skips a file with no number in front when counting", () => {
    const ws = tmpWs();
    const dir = repoPath(ws, SCRATCH);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "no-number.md"), "x");
    const r = persistTmp({ content: VALID_TMP, created: CREATED, workspaceRoot: ws });
    expect(r.serial).toBe(1);
  });
});

describe("persistTmp serial limits", () => {
  it("refuses a serial that no longer prints as digits", () => {
    const ws = tmpWs();
    const dir = repoPath(ws, SCRATCH);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${"1".padEnd(22, "0")}-old-${STAMP}.md`), "x");
    const r = persistTmp({ content: VALID_TMP, created: CREATED, workspaceRoot: ws });
    expect(r).toStrictEqual({ error: "filename", ok: false });
    expect(fs.readdirSync(dir)).toHaveLength(1);
  });
});

describe("persistTmp stamp and root", () => {
  it("stamps now when created is not a UTC datetime", () => {
    const r = persistTmp({ content: VALID_TMP, created: "2026-08-27", workspaceRoot: tmpWs() });
    expect(r.filename).toMatch(/^1-bank-email-draft-\d{8}T\d{6}Z\.md$/);
    expect(r.filename).not.toContain("20260827T");
  });

  it("saves under the repo root of the working directory when no workspace is given", () => {
    saveAtRepoRoot({ body: VALID_TMP, dir: `${REPO}/${SCRATCH}`, save: persistTmp, tmpWs });
    expect(persistTmp()).toStrictEqual({ error: "missing TMP_NAME", ok: false });
  });
});
