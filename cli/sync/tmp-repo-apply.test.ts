import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { useTempDirs } from "../__fixtures__/temp-dirs.ts";
import { put } from "./__fixtures__/temp-dirs.ts";
import { applyMigration } from "./apply-migration.ts";
import { planTmpRepo, rewriteOldPaths } from "./tmp-repo.ts";

const { tempDir } = useTempDirs("tmp-repo-apply-");

function read(root: string, rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function exists(root: string, rel: string): boolean {
  return fs.existsSync(path.join(root, rel));
}

function afterStep(index: number): void {
  if (index === 0) throw new Error("crash");
}

describe("applyMigration of the .tmp/repo plan", () => {
  it("removes an empty .tmp/repo and keeps .tmp", async () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, ".tmp/repo"), { recursive: true });
    await applyMigration(root, planTmpRepo(root));

    expect(exists(root, ".tmp/repo")).toBe(false);
    expect(exists(root, ".tmp")).toBe(true);
  });

  it("changes nothing with a conflict", async () => {
    const root = tempDir();
    put(root, ".tmp/repo/plans/a.md", "old");
    put(root, ".tmp/repo/notes.md", "n");
    put(root, ".repo/plans/a.md", "new");
    const lines = await applyMigration(root, planTmpRepo(root));

    expect(lines).toHaveLength(1);
    expect(read(root, ".tmp/repo/plans/a.md")).toBe("old");
    expect(read(root, ".repo/plans/a.md")).toBe("new");
    expect(exists(root, ".tmp/repo/notes.md")).toBe(true);
  });
});

describe("applyMigration rewriting", () => {
  it("merges identical files and files that match once mapped", async () => {
    const root = tempDir();
    put(root, ".tmp/repo/plans/a.md", "see .tmp/repo/plans/x");
    put(root, ".repo/plans/a.md", "see .repo/plans/x");
    put(root, ".tmp/repo/plans/same.md", "same");
    put(root, ".repo/plans/same.md", "same");
    await applyMigration(root, planTmpRepo(root));

    expect(exists(root, ".tmp/repo")).toBe(false);
    expect(read(root, ".repo/plans/a.md")).toBe("see .repo/plans/x");
    expect(read(root, ".repo/plans/same.md")).toBe("same");
  });

  it("rewrites text, keeps a binary file byte-identical, and leaves .tmp/mine.txt", async () => {
    const root = tempDir();
    const binary = Buffer.from("\0 .tmp/repo/plans/x");
    put(root, ".tmp/repo/sessions/a.txt", "cd .tmp/repo/plans/x");
    put(root, ".tmp/repo/sessions/b.json", '{"p":".tmp/repo/stash/y"}');
    put(root, ".tmp/repo/sessions/c.bin", binary.toString());
    put(root, ".tmp/mine.txt", "mine");
    const lines = await applyMigration(root, planTmpRepo(root));

    expect(lines).toContain("repo sync: moved .tmp/repo/sessions to .repo/tmp/sessions");
    expect(lines).toContain("repo sync: removed the empty .tmp/repo");
    expect(read(root, ".repo/tmp/sessions/a.txt")).toBe("cd .repo/plans/x");
    expect(read(root, ".repo/tmp/sessions/b.json")).toBe('{"p":".repo/tmp/stash/y"}');
    expect(fs.readFileSync(path.join(root, ".repo/tmp/sessions/c.bin")).equals(binary)).toBe(true);
    expect(read(root, ".tmp/mine.txt")).toBe("mine");
    expect(planTmpRepo(root)).toStrictEqual([]);
  });
});

describe("applyMigration after a crash and prune", () => {
  it("moves a tree already rewritten but not moved, content unchanged", async () => {
    const root = tempDir();
    put(root, ".tmp/repo/sessions/a.txt", "cd .tmp/repo/plans/x");
    rewriteOldPaths(path.join(root, ".tmp/repo/sessions"));
    await applyMigration(root, planTmpRepo(root));

    expect(read(root, ".repo/tmp/sessions/a.txt")).toBe("cd .repo/plans/x");
    expect(exists(root, ".tmp/repo")).toBe(false);
  });

  it("finishes after a crash following step 0", async () => {
    const root = tempDir();
    put(root, ".tmp/repo/notes.md", "n .tmp/repo/plans/x");
    put(root, ".tmp/repo/plans/p.md", "p");

    await expect(applyMigration(root, planTmpRepo(root), { afterStep })).rejects.toThrow("crash");
    expect(exists(root, ".tmp/repo/plans/p.md")).toBe(true);
    await applyMigration(root, planTmpRepo(root));

    expect(read(root, ".repo/scratch/notes.md")).toBe("n .repo/plans/x");
    expect(read(root, ".repo/plans/p.md")).toBe("p");
    expect(planTmpRepo(root)).toStrictEqual([]);
  });

  it("prunes nothing and prints nothing for a non-empty or missing dir", async () => {
    const root = tempDir();
    put(root, ".tmp/repo/x/y", "y");
    const step = { kind: "prune", note: "removed", path: ".tmp/repo" } as const;

    expect(await applyMigration(root, [step])).toStrictEqual([]);
    expect(exists(root, ".tmp/repo/x/y")).toBe(true);
    expect(await applyMigration(tempDir(), [step])).toStrictEqual([]);
  });
});
