import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { useTempDirs } from "../__fixtures__/temp-dirs.ts";
import { mapOldPaths, rewriteOldPaths } from "./tmp-repo.ts";

const { tempDir } = useTempDirs("tmp-repo-");

describe("mapOldPaths", () => {
  it.each([
    ["/r/.tmp/repo/plans/1-a.md", "/r/.repo/plans/1-a.md"],
    [".tmp/repo/sessions/s1", ".repo/tmp/sessions/s1"],
    [".tmp/repo/notes.md", ".repo/scratch/notes.md"],
    [".tmp/repo/red-proof-abc/x", ".repo/tmp/red-proof-abc/x"],
    ["`.tmp/repo/red-proof-${id}/x`", "`.repo/tmp/red-proof-${id}/x`"],
    [String.raw`C:\r\.tmp\repo\plans\x.md`, String.raw`C:\r\.repo\plans\x.md`],
    [String.raw`C:\\r\\.tmp\\repo\\plans`, String.raw`C:\\r\\.repo\\plans`],
    ['join(r, ".tmp" "repo" "plans")', 'join(r, ".repo" "plans")'],
    ['join(r, ".tmp", "repo", "sessions")', 'join(r, ".repo", "tmp", "sessions")'],
    ["'.tmp' 'repo' 'stash'", "'.repo' 'tmp' 'stash'"],
  ])("maps %s", (from, to) => {
    expect(mapOldPaths(from)).toBe(to);
    expect(mapOldPaths(to)).toBe(to);
  });

  it.each([".tmp/repo", "see .tmp/repo/ here", 'join(".tmp", "repo")', ".tmp/repository/x", ".tmp/other/x"])(
    "leaves %s as written",
    (text) => {
      expect(mapOldPaths(text)).toBe(text);
    },
  );
});

describe("rewriteOldPaths", () => {
  it("rewrites text files in place, skips binary files, and counts the changes", () => {
    const dir = tempDir();
    const binary = Buffer.from("\0 .tmp/repo/plans/x");
    fs.mkdirSync(path.join(dir, "sub"));
    fs.writeFileSync(path.join(dir, "sub", "a.md"), "see .tmp/repo/plans/x");
    fs.writeFileSync(path.join(dir, "b.md"), "clean");
    fs.writeFileSync(path.join(dir, "c.bin"), binary);
    fs.symlinkSync(path.join(dir, "b.md"), path.join(dir, "link"));

    expect(rewriteOldPaths(dir)).toBe(1);
    expect(fs.readFileSync(path.join(dir, "sub", "a.md"), "utf8")).toBe("see .repo/plans/x");
    expect(fs.readFileSync(path.join(dir, "b.md"), "utf8")).toBe("clean");
    expect(fs.readFileSync(path.join(dir, "c.bin")).equals(binary)).toBe(true);
  });

  it("rewrites a single file", () => {
    const file = path.join(tempDir(), "a.md");
    fs.writeFileSync(file, "see .tmp/repo/plans/x");

    expect(rewriteOldPaths(file)).toBe(1);
    expect(fs.readFileSync(file, "utf8")).toBe("see .repo/plans/x");
  });
});
