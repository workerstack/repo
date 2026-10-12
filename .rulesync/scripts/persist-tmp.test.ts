import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TMP_DIR, persistTmp } from "./persist-tmp.mjs";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function tmpWs() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "persist-tmp-"));
  tmpDirs.push(dir);
  return dir;
}

export const VALID_TMP = `TMP_NAME: bank email draft
TMP_EXT: md

Subject: hello

Please send the statement.
`;

describe("persistTmp", () => {
  it("writes a stamped artifact under .tmp/grunt with no TMP_* or YAML", () => {
    const ws = tmpWs();
    const r = persistTmp({
      workspaceRoot: ws,
      content: VALID_TMP,
      created: "2026-08-27T14:30:00Z",
    });
    expect(r.ok).toBe(true);
    expect(r.serial).toBe(1);
    expect(r.filename).toBe("1-bank-email-draft-20260827T143000Z.md");
    expect(r.path).toBe(path.join(ws, TMP_DIR, r.filename!));
    const text = fs.readFileSync(r.path!, "utf8");
    expect(text).toBe(r.content);
    expect(text).not.toMatch(/^---/);
    expect(text).not.toContain("TMP_NAME:");
    expect(text).not.toContain("TMP_EXT:");
    expect(text).toContain("Subject: hello");
  });

  it("defaults ext to md when TMP_EXT is omitted", () => {
    const ws = tmpWs();
    const r = persistTmp({
      workspaceRoot: ws,
      content: "TMP_NAME: note only\n\nhello\n",
      created: "2026-08-27T14:30:00Z",
    });
    expect(r.ok).toBe(true);
    expect(r.filename).toBe("1-note-only-20260827T143000Z.md");
  });

  it("uses TMP_EXT for the filename", () => {
    const ws = tmpWs();
    const r = persistTmp({
      workspaceRoot: ws,
      content: "TMP_NAME: shell snippet\nTMP_EXT: sh\n\necho hi\n",
      created: "2026-08-27T14:30:00Z",
    });
    expect(r.ok).toBe(true);
    expect(r.filename).toBe("1-shell-snippet-20260827T143000Z.sh");
    expect(fs.readFileSync(r.path!, "utf8")).toBe("\necho hi\n");
  });

  it("does not collide with plan or handoff serials", () => {
    const ws = tmpWs();
    fs.mkdirSync(path.join(ws, ".tmp/grunt/plans"), { recursive: true });
    fs.mkdirSync(path.join(ws, ".tmp/grunt/handoffs"), { recursive: true });
    fs.mkdirSync(path.join(ws, ".tmp/grunt/implementations"), { recursive: true });
    fs.writeFileSync(path.join(ws, ".tmp/grunt/plans/9-other-20260827T143000Z.md"), "x");
    fs.writeFileSync(
      path.join(ws, ".tmp/grunt/handoffs/9-other-20260827T143000Z.md"),
      "x",
    );
    fs.writeFileSync(
      path.join(ws, ".tmp/grunt/implementations/9-other-20260827T143000Z.md"),
      "x",
    );
    const r = persistTmp({ workspaceRoot: ws, content: VALID_TMP });
    expect(r.serial).toBe(1);
  });

  it("skips directories when allocating serial", () => {
    const ws = tmpWs();
    const dir = path.join(ws, TMP_DIR);
    fs.mkdirSync(path.join(dir, "9-not-a-dump"), { recursive: true });
    fs.mkdirSync(path.join(dir, "tmp"), { recursive: true });
    fs.writeFileSync(path.join(dir, "tmp/9-nested-20260827T143000Z.md"), "x");
    const r = persistTmp({ workspaceRoot: ws, content: VALID_TMP });
    expect(r.serial).toBe(1);
    expect(r.path).toBe(path.join(dir, r.filename!));
  });

  it("increments serial and keeps the same stamp", () => {
    const ws = tmpWs();
    const created = "2026-08-27T14:30:00Z";
    const a = persistTmp({ workspaceRoot: ws, content: VALID_TMP, created });
    const b = persistTmp({ workspaceRoot: ws, content: VALID_TMP, created });
    expect(a.serial).toBe(1);
    expect(b.serial).toBe(2);
    expect(b.filename).toBe("2-bank-email-draft-20260827T143000Z.md");
  });

  it("counts mixed extensions for the next serial", () => {
    const ws = tmpWs();
    const created = "2026-08-27T14:30:00Z";
    persistTmp({
      workspaceRoot: ws,
      content: "TMP_NAME: one\nTMP_EXT: txt\n\na\n",
      created,
    });
    const b = persistTmp({
      workspaceRoot: ws,
      content: "TMP_NAME: two\n\nb\n",
      created,
    });
    expect(b.serial).toBe(2);
    expect(b.filename).toBe("2-two-20260827T143000Z.md");
  });

  it("ignores .tmp in gitignore only once", () => {
    const ws = tmpWs();
    fs.writeFileSync(path.join(ws, ".gitignore"), "node_modules\n");
    persistTmp({ workspaceRoot: ws, content: VALID_TMP });
    persistTmp({ workspaceRoot: ws, content: VALID_TMP });
    const gi = fs.readFileSync(path.join(ws, ".gitignore"), "utf8");
    expect(gi.match(/^\.tmp\/$/gm)?.length).toBe(1);
  });

  it("rejects missing TMP_NAME and does not write", () => {
    const ws = tmpWs();
    const r = persistTmp({ workspaceRoot: ws, content: "just a dump\n" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("missing TMP_NAME");
    expect(fs.existsSync(path.join(ws, TMP_DIR))).toBe(false);
  });

  it("rejects an invalid TMP_EXT and does not write", () => {
    const ws = tmpWs();
    const r = persistTmp({
      workspaceRoot: ws,
      content: "TMP_NAME: bad ext\nTMP_EXT: ../x\n\nnope\n",
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("ext");
    expect(
      fs.existsSync(path.join(ws, TMP_DIR))
        ? fs.readdirSync(path.join(ws, TMP_DIR))
        : [],
    ).toEqual([]);
  });

  it("rejects binary content", () => {
    const ws = tmpWs();
    const r = persistTmp({
      workspaceRoot: ws,
      content: "TMP_NAME: bin\n\n" + "a\0b",
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("binary");
  });

  it("does not rewrite an existing dump", () => {
    const ws = tmpWs();
    const created = "2026-08-27T14:30:00Z";
    const a = persistTmp({ workspaceRoot: ws, content: VALID_TMP, created });
    const first = fs.readFileSync(a.path!, "utf8");
    persistTmp({
      workspaceRoot: ws,
      content: "TMP_NAME: bank email draft\n\nchanged\n",
      created,
    });
    expect(fs.readFileSync(a.path!, "utf8")).toBe(first);
  });
});
