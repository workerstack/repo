import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { tempDir, useTempDirs } from "../sync/__fixtures__/temp-dirs.ts";
import { VALID_TMP, savedOk } from "./__fixtures__/persist-bodies.ts";
import { TMP_DIR, persistTmp } from "./persist-tmp.ts";

useTempDirs();

function tmpWs(): string {
  return tempDir("persist-tmp-");
}

describe("persistTmp", () => {
  it("writes a stamped artifact under .tmp/repo with no TMP_* or YAML", () => {
    const ws = tmpWs();
    const r = persistTmp({
      content: VALID_TMP,
      created: "2026-08-27T14:30:00Z",
      workspaceRoot: ws,
    });
    expect(r.ok).toBe(true);
    expect(r.serial).toBe(1);
    expect(r.filename).toBe("1-bank-email-draft-20260827T143000Z.md");
    expect(r.path).toBe(`${TMP_DIR}/${r.filename}`);
    expect(path.isAbsolute(savedOk(r).path)).toBe(false);
    const text = fs.readFileSync(path.join(ws, savedOk(r).path), "utf8");
    expect(text).toBe(r.content);
    expect(text).not.toMatch(/^---/);
    expect(text).not.toContain("TMP_NAME:");
    expect(text).not.toContain("TMP_EXT:");
    expect(text).toContain("Subject: hello");
  });
});

describe("persistTmp extensions", () => {
  it("defaults ext to md when TMP_EXT is omitted", () => {
    const ws = tmpWs();
    const r = persistTmp({
      content: "TMP_NAME: note only\n\nhello\n",
      created: "2026-08-27T14:30:00Z",
      workspaceRoot: ws,
    });
    expect(r.ok).toBe(true);
    expect(r.filename).toBe("1-note-only-20260827T143000Z.md");
  });

  it("uses TMP_EXT for the filename", () => {
    const ws = tmpWs();
    const r = persistTmp({
      content: "TMP_NAME: shell snippet\nTMP_EXT: sh\n\necho hi\n",
      created: "2026-08-27T14:30:00Z",
      workspaceRoot: ws,
    });
    expect(r.ok).toBe(true);
    expect(r.filename).toBe("1-shell-snippet-20260827T143000Z.sh");
    expect(fs.readFileSync(path.join(ws, savedOk(r).path), "utf8")).toBe("\necho hi\n");
  });
});

describe("persistTmp serials", () => {
  it("does not collide with plan or handoff serials", () => {
    const ws = tmpWs();
    fs.mkdirSync(path.join(ws, ".tmp/repo/plans"), { recursive: true });
    fs.mkdirSync(path.join(ws, ".tmp/repo/handoffs"), { recursive: true });
    fs.mkdirSync(path.join(ws, ".tmp/repo/implementations"), { recursive: true });
    fs.writeFileSync(path.join(ws, ".tmp/repo/plans/9-other-20260827T143000Z.md"), "x");
    fs.writeFileSync(path.join(ws, ".tmp/repo/handoffs/9-other-20260827T143000Z.md"), "x");
    fs.writeFileSync(path.join(ws, ".tmp/repo/implementations/9-other-20260827T143000Z.md"), "x");
    const r = persistTmp({ content: VALID_TMP, workspaceRoot: ws });
    expect(r.serial).toBe(1);
  });

  it("skips directories when allocating serial", () => {
    const ws = tmpWs();
    const dir = path.join(ws, TMP_DIR);
    fs.mkdirSync(path.join(dir, "9-not-a-dump"), { recursive: true });
    fs.mkdirSync(path.join(dir, "tmp"), { recursive: true });
    fs.writeFileSync(path.join(dir, "tmp/9-nested-20260827T143000Z.md"), "x");
    const r = persistTmp({ content: VALID_TMP, workspaceRoot: ws });
    expect(r.serial).toBe(1);
    expect(r.path).toBe(`${TMP_DIR}/${r.filename}`);
  });
});

describe("persistTmp mixed serials", () => {
  it("increments serial and keeps the same stamp", () => {
    const ws = tmpWs();
    const created = "2026-08-27T14:30:00Z";
    const a = persistTmp({ content: VALID_TMP, created, workspaceRoot: ws });
    const b = persistTmp({ content: VALID_TMP, created, workspaceRoot: ws });
    expect(a.serial).toBe(1);
    expect(b.serial).toBe(2);
    expect(b.filename).toBe("2-bank-email-draft-20260827T143000Z.md");
  });

  it("counts mixed extensions for the next serial", () => {
    const ws = tmpWs();
    const created = "2026-08-27T14:30:00Z";
    persistTmp({
      content: "TMP_NAME: one\nTMP_EXT: txt\n\na\n",
      created,
      workspaceRoot: ws,
    });
    const b = persistTmp({
      content: "TMP_NAME: two\n\nb\n",
      created,
      workspaceRoot: ws,
    });
    expect(b.serial).toBe(2);
    expect(b.filename).toBe("2-two-20260827T143000Z.md");
  });
});

describe("persistTmp gitignore and name", () => {
  it("never touches .gitignore", () => {
    const ws = tmpWs();
    persistTmp({ content: VALID_TMP, workspaceRoot: ws });
    expect(fs.existsSync(path.join(ws, ".gitignore"))).toBe(false);
    const kept = tmpWs();
    fs.writeFileSync(path.join(kept, ".gitignore"), "node_modules\n");
    persistTmp({ content: VALID_TMP, workspaceRoot: kept });
    persistTmp({ content: VALID_TMP, workspaceRoot: kept });
    expect(fs.readFileSync(path.join(kept, ".gitignore"), "utf8")).toBe("node_modules\n");
  });

  it("rejects missing TMP_NAME and does not write", () => {
    const ws = tmpWs();
    const r = persistTmp({ content: "just a dump\n", workspaceRoot: ws });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("missing TMP_NAME");
    expect(fs.existsSync(path.join(ws, TMP_DIR))).toBe(false);
  });
});

describe("persistTmp refused content", () => {
  it("rejects an invalid TMP_EXT and does not write", () => {
    const ws = tmpWs();
    const r = persistTmp({
      content: "TMP_NAME: bad ext\nTMP_EXT: ../x\n\nnope\n",
      workspaceRoot: ws,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("ext");
    expect(fs.existsSync(path.join(ws, TMP_DIR)) ? fs.readdirSync(path.join(ws, TMP_DIR)) : []).toStrictEqual([]);
  });

  it("rejects binary content", () => {
    const ws = tmpWs();
    const r = persistTmp({
      content: "TMP_NAME: bin\n\na\0b",
      workspaceRoot: ws,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("binary");
  });
});

describe("persistTmp existing dump", () => {
  it("does not rewrite an existing dump", () => {
    const ws = tmpWs();
    const created = "2026-08-27T14:30:00Z";
    const a = persistTmp({ content: VALID_TMP, created, workspaceRoot: ws });
    const first = fs.readFileSync(path.join(ws, savedOk(a).path), "utf8");
    persistTmp({
      content: "TMP_NAME: bank email draft\n\nchanged\n",
      created,
      workspaceRoot: ws,
    });
    expect(fs.readFileSync(path.join(ws, savedOk(a).path), "utf8")).toBe(first);
  });
});
