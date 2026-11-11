import path from "node:path";

import { describe, expect, it } from "vitest";

import { put, useTempDirs } from "../sync/fixtures/temp-dirs.ts";
import { ignoreRepo } from "./fixtures/ignore-kit.ts";
import { ignoreTarget, projectEdit, writeIgnoreEdits } from "./ignore-edits.ts";
import { parentIgnoreFiles } from "./redundant-ignore-lines.ts";

useTempDirs();

describe("projectEdit", () => {
  it("applies Claude edits and fails on a missing old string", () => {
    expect(
      projectEdit("a\nb\n", {
        edits: [
          { new_string: "x", old_string: "a" },
          { newString: "y", oldString: "b" },
        ],
      }),
    ).toBe("x\ny\n");
    expect(
      projectEdit("a a\nb\n", {
        edits: [
          { new_string: "z", old_string: "a", replace_all: true },
          { new_string: "q", old_string: "b" },
        ],
      }),
    ).toBe("z z\nq\n");
    expect(projectEdit("a\n", { new_string: "x", old_string: "missing" })).toBeNull();
  });

  it("applies an Antigravity 1.5.3 edit_file, which names its strings Target and Replacement", () => {
    expect(projectEdit("a\nb\n", { Path: "/r/.gitignore", Replacement: "b\nc", Target: "b" })).toBe("a\nb\nc\n");
    expect(projectEdit("a\n", { Replacement: "x", Target: "missing" })).toBeNull();
  });
});

describe("writeIgnoreEdits", () => {
  const fields = ["file_path", "Path"];

  it("reads an Antigravity write_file from Content, and an edit_file from Target and Replacement", () => {
    const r = ignoreRepo();
    const file = path.join(r, "packages/a/.gitignore");
    put(r, "packages/a/.gitignore", "out/\n");
    expect(writeIgnoreEdits({ Content: "out/\n.tmp/\n", Path: file }, r, fields)).toStrictEqual([
      { added: [".tmp/"], file },
    ]);
    expect(writeIgnoreEdits({ Path: file, Replacement: "out/\n.tmp/", Target: "out/" }, r, fields)).toStrictEqual([
      { added: [".tmp/"], file },
    ]);
    expect(writeIgnoreEdits({ Path: file, Replacement: ".tmp/", Target: "missing" }, r, fields)).toStrictEqual([]);
  });

  it("still reads Claude's content and old_string/new_string", () => {
    const r = ignoreRepo();
    const file = path.join(r, "packages/a/.gitignore");
    put(r, "packages/a/.gitignore", "out/\n");
    expect(writeIgnoreEdits({ content: ".tmp/\n", file_path: file }, r, fields)).toStrictEqual([
      { added: [".tmp/"], file },
    ]);
    expect(
      writeIgnoreEdits({ file_path: file, new_string: "out/\n.tmp/", old_string: "out/" }, r, fields),
    ).toStrictEqual([{ added: [".tmp/"], file }]);
  });
});

describe("paths", () => {
  it("resolves only .gitignore targets, on win32 too", () => {
    expect(ignoreTarget("packages\\a\\.gitignore", "C:\\r", path.win32)).toBe("C:\\r\\packages\\a\\.gitignore");
    expect(ignoreTarget("packages/a/notes.md", "/r")).toBeNull();
    expect(parentIgnoreFiles("C:\\r\\packages\\a\\.gitignore", "C:/r", path.win32)).toStrictEqual([
      ".gitignore",
      "packages/.gitignore",
    ]);
    expect(parentIgnoreFiles("/r/.gitignore", "/r")).toStrictEqual([]);
  });
});
