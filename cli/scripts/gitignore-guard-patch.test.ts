import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { useTempTree } from "../__fixtures__/temp-tree.ts";
import { patchIgnoreEdits, projectEdit, writeIgnoreEdits } from "./ignore-edits.ts";

const tree = useTempTree("ignore-patch-");

/** An empty temp dir, by its real path. */
function root() {
  return fs.realpathSync(tree({}));
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
    expect(patchIgnoreEdits(ADD_PATCH, r)).toStrictEqual([
      { added: [".tmp/"], file: path.join(r, "pkg/.gitignore") },
      { added: ["dist/"], file: path.join(r, "other/.gitignore") },
    ]);
  });

  it("follows a move to the new path and drops a deleted file's lines", () => {
    const r = root();
    expect(patchIgnoreEdits(MOVE_PATCH, r)).toStrictEqual([{ added: [".tmp/"], file: path.join(r, "pkg/.gitignore") }]);
  });

  it("ignores a move before any file section", () => {
    expect(patchIgnoreEdits("*** Move to: pkg/.gitignore\n+x/", root())).toStrictEqual([]);
  });

  it("returns nothing for text with no sections", () => {
    expect(patchIgnoreEdits("+x/\nplain", root())).toStrictEqual([]);
  });
});

describe("writeIgnoreEdits and projectEdit on odd input", () => {
  const fields = ["file_path", "Path"];

  it("treats a missing .gitignore as empty, so every line is added", () => {
    const r = root();
    const file = path.join(r, "new/.gitignore");
    expect(writeIgnoreEdits({ content: "a/\n", file_path: file }, r, fields)).toStrictEqual([{ added: ["a/"], file }]);
  });

  it("returns no edit when no field names a .gitignore", () => {
    const r = root();
    expect(writeIgnoreEdits({ content: "x", file_path: path.join(r, "notes.md") }, r, fields)).toStrictEqual([]);
    expect(writeIgnoreEdits({ file_path: 3 }, r, fields)).toStrictEqual([]);
    expect(writeIgnoreEdits({ file_path: "" }, r, fields)).toStrictEqual([]);
  });

  it("fails an edit list holding something that is not an edit", () => {
    expect(projectEdit("a\n", { edits: ["nope"] })).toBeNull();
    expect(projectEdit("a\n", { edits: [{ old_string: "a" }] })).toBeNull();
  });

  it("applies the camel-case replaceAll flag", () => {
    expect(projectEdit("a a\n", { new_string: "b", old_string: "a", replaceAll: true })).toBe("b b\n");
  });
});
