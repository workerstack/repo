import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { useTempDirs } from "../__fixtures__/temp-dirs.ts";
import { put } from "./__fixtures__/temp-dirs.ts";
import { planTmpRepo } from "./tmp-repo.ts";

const { tempDir } = useTempDirs("tmp-repo-plan-");

function move(name: string, home: string) {
  return {
    from: `.tmp/repo/${name}`,
    kind: "move",
    note: `moved .tmp/repo/${name} to .repo/${home}`,
    relocate: true,
    to: `.repo/${home}`,
  };
}

const PRUNE = { kind: "prune", note: "removed the empty .tmp/repo", path: ".tmp/repo" };

function conflicts(root: string): object[] {
  return planTmpRepo(root).filter((step) => step.kind === "conflict");
}

describe("planTmpRepo without entries", () => {
  it("plans nothing without .tmp/repo", () => {
    const root = tempDir();
    put(root, ".tmp/mine.txt", "mine");

    expect(planTmpRepo(root)).toStrictEqual([]);
  });

  it("plans only the prune of an empty .tmp/repo", () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, ".tmp/repo"), { recursive: true });

    expect(planTmpRepo(root)).toStrictEqual([PRUNE]);
  });
});

describe("planTmpRepo moves", () => {
  it("plans one move per entry, sorted, then the prune", () => {
    const root = tempDir();
    put(root, ".tmp/repo/sessions/s.txt", "s");
    put(root, ".tmp/repo/notes.md", "n");
    put(root, ".tmp/repo/plans/p.md", "p");

    expect(planTmpRepo(root)).toStrictEqual([
      move("notes.md", "scratch/notes.md"),
      move("plans", "plans"),
      move("sessions", "tmp/sessions"),
      PRUNE,
    ]);
  });
});

describe("planTmpRepo conflicts", () => {
  it("plans a conflict per differing file", () => {
    const root = tempDir();
    put(root, ".tmp/repo/plans/a.md", "old");
    put(root, ".tmp/repo/plans/same.md", "same");
    put(root, ".tmp/repo/plans/dir/x.md", "x");
    put(root, ".tmp/repo/plans/file", "f");
    put(root, ".repo/plans/a.md", "new");
    put(root, ".repo/plans/same.md", "same");
    put(root, ".repo/plans/dir", "now a file");
    put(root, ".repo/plans/file/y.md", "y");

    expect(conflicts(root)).toStrictEqual([
      { from: ".tmp/repo/plans/a.md", kind: "conflict", to: ".repo/plans/a.md" },
      { from: ".tmp/repo/plans/dir", kind: "conflict", to: ".repo/plans/dir" },
      { from: ".tmp/repo/plans/file", kind: "conflict", to: ".repo/plans/file" },
    ]);
  });

  it("plans no conflict for a file that matches its home once mapped", () => {
    const root = tempDir();
    put(root, ".tmp/repo/plans/a.md", "see .tmp/repo/plans/x");
    put(root, ".repo/plans/a.md", "see .repo/plans/x");

    expect(conflicts(root)).toStrictEqual([]);
  });

  it("compares a binary file as it is", () => {
    const root = tempDir();
    put(root, ".tmp/repo/plans/b.bin", "\0 .tmp/repo/plans/x");
    put(root, ".repo/plans/b.bin", "\0 .repo/plans/x");

    expect(conflicts(root)).toHaveLength(1);
  });
});
