import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { patchIgnoreEdits, projectEdit, writeIgnoreEdits } from "./gitignore-guard.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function root() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ignore-patch-")));
  dirs.push(dir);
  return dir;
}

const ADD_PATCH = [
  "*** Begin Patch",
  "*** Add File: pkg/.gitignore",
  "+.tmp/",
  "+# note",
  "+",
  "*** Update File: notes.md",
  "+not an ignore file",
  "*** Update File: other/.gitignore",
  " context",
  "+dist/",
  "*** End Patch",
].join("\n");

const MOVE_PATCH = [
  "*** Update File: old.txt",
  "*** Move to: pkg/.gitignore",
  "+.tmp/",
  "*** Delete File: gone/.gitignore",
  "+ignored/",
].join("\n");

describe("patchIgnoreEdits", () => {
  it("reads the plus lines of an added or updated .gitignore and skips other files", () => {
    const r = root();
    expect(patchIgnoreEdits(ADD_PATCH, r)).toEqual([
      { file: path.join(r, "pkg/.gitignore"), added: [".tmp/"] },
      { file: path.join(r, "other/.gitignore"), added: ["dist/"] },
    ]);
  });

  it("follows a move to the new path and drops a deleted file's lines", () => {
    const r = root();
    expect(patchIgnoreEdits(MOVE_PATCH, r)).toEqual([{ file: path.join(r, "pkg/.gitignore"), added: [".tmp/"] }]);
  });

  it("ignores a move before any file section", () => {
    expect(patchIgnoreEdits("*** Move to: pkg/.gitignore\n+x/", root())).toEqual([]);
  });

  it("returns nothing for text with no sections", () => {
    expect(patchIgnoreEdits("+x/\nplain", root())).toEqual([]);
  });
});

describe("writeIgnoreEdits and projectEdit on odd input", () => {
  const FIELDS = ["file_path", "Path"];

  it("treats a missing .gitignore as empty, so every line is added", () => {
    const r = root();
    const file = path.join(r, "new/.gitignore");
    expect(writeIgnoreEdits({ file_path: file, content: "a/\n" }, r, FIELDS)).toEqual([{ file, added: ["a/"] }]);
  });

  it("returns no edit when no field names a .gitignore", () => {
    const r = root();
    expect(writeIgnoreEdits({ file_path: path.join(r, "notes.md"), content: "x" }, r, FIELDS)).toEqual([]);
    expect(writeIgnoreEdits({ file_path: 3 }, r, FIELDS)).toEqual([]);
    expect(writeIgnoreEdits({ file_path: "" }, r, FIELDS)).toEqual([]);
  });

  it("fails an edit list holding something that is not an edit", () => {
    expect(projectEdit("a\n", { edits: ["nope"] })).toBeNull();
    expect(projectEdit("a\n", { edits: [{ old_string: "a" }] })).toBeNull();
  });

  it("applies the camel-case replaceAll flag", () => {
    expect(projectEdit("a a\n", { old_string: "a", new_string: "b", replaceAll: true })).toBe("b b\n");
  });
});
