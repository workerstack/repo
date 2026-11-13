import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { childEnv } from "../env.ts";
import { put, tempDir, useTempDirs } from "./__fixtures__/temp-dirs.ts";
import { moveLines, moveOldConfig, oldConfigHint } from "./migrate-config-name.ts";

useTempDirs();

const OLD = "workerstack.config.ts";
const NEW = "repo.config.ts";
const IS_NOW = "workerstack.config.ts is now repo.config.ts; run bun repo sync";
const BOTH = "both workerstack.config.ts and repo.config.ts exist; delete one";

const OLD_CONFIG =
  'import type { WorkerstackConfig } from "@workerstack/repo";\n\nexport default {} satisfies WorkerstackConfig;\n';

const NEW_CONFIG = 'import type { RepoConfig } from "@workerstack/repo";\n\nexport default {} satisfies RepoConfig;\n';
const DOC = "Edit workerstack.config.ts; its type is WorkerstackConfig, not WorkerstackConfigs.\n";
const READ_ONLY = 0o444;
const FILE_MODE = 0o777;

const BINARY = Buffer.concat([
  Buffer.from("workerstack.config.ts"),
  Buffer.from([0]),
  Buffer.from("WorkerstackConfig"),
]);

/** A git repo holding the old config, a doc and a package source that name it, and files the rewrite must skip. */
function consumer({ git = true }: { git?: boolean } = {}): string {
  const root = tempDir("workerstack-config-name-");

  if (git) execFileSync("git", ["init", "-q"], { cwd: root, env: childEnv() });
  put(root, OLD, OLD_CONFIG);
  put(root, "README.md", DOC);
  put(root, "packages/api/src/config.ts", "// read from ../../workerstack.config.ts\n");
  put(root, "packages/api/src/plain.ts", "export const plain = 1;\n");
  put(root, "CHANGELOG.md", DOC);
  put(root, "packages/api/CHANGELOG.md", DOC);
  put(root, ".gitignore", "ignored.md\n");
  put(root, "ignored.md", DOC);
  fs.writeFileSync(path.join(root, "logo.bin"), BINARY);

  if (git) {
    // A tracked file deleted from the tree is still listed.
    put(root, "gone.md", DOC);
    execFileSync("git", ["add", "gone.md"], { cwd: root, env: childEnv() });
    fs.rmSync(path.join(root, "gone.md"));
  }

  return root;
}

function read(root: string, rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

/** Every file under `root` but `.git`, keyed by its `/` path, with its bytes. */
function snapshot(root: string) {
  const files: Record<string, string> = {};

  for (const native of fs.readdirSync(root, { encoding: "utf8", recursive: true }).toSorted()) {
    const file = path.join(root, native);
    const rel = native.split(path.sep).join("/");

    if (!rel.startsWith(".git/") && fs.statSync(file).isFile()) files[rel] = fs.readFileSync(file, "latin1");
  }

  return files;
}

it("rewrites both old names in every listed text file, then moves the config", () => {
  const root = consumer();
  fs.chmodSync(path.join(root, "README.md"), READ_ONLY);
  const before = snapshot(root);
  const moved = moveOldConfig(root, { check: false });
  expect(moved).toStrictEqual({
    dir: path.resolve(root),
    rewritten: ["README.md", "packages/api/src/config.ts", OLD],
  });
  expect(fs.existsSync(path.join(root, OLD))).toBe(false);
  expect(read(root, NEW)).toBe(NEW_CONFIG);
  expect(read(root, "README.md")).toBe("Edit repo.config.ts; its type is RepoConfig, not WorkerstackConfigs.\n");
  expect(fs.statSync(path.join(root, "README.md")).mode & FILE_MODE).toBe(READ_ONLY);
  expect(read(root, "packages/api/src/config.ts")).toBe("// read from ../../repo.config.ts\n");

  for (const rel of [
    "packages/api/src/plain.ts",
    "CHANGELOG.md",
    "packages/api/CHANGELOG.md",
    "ignored.md",
    "logo.bin",
  ])
    expect(fs.readFileSync(path.join(root, rel), "latin1")).toBe(before[rel]);
});

it("finds the config from a subdir of its repo", () => {
  const root = consumer();
  const moved = moveOldConfig(path.join(root, "packages", "api"), { check: false });
  expect(moved).toMatchObject({ dir: path.resolve(root) });
  expect(read(root, NEW)).toBe(NEW_CONFIG);
});

it("writes nothing on a rerun", () => {
  const root = consumer();
  moveOldConfig(root, { check: false });
  const after = snapshot(root);
  expect(moveOldConfig(root, { check: false })).toBeNull();
  expect(snapshot(root)).toStrictEqual(after);
});

it("finishes a run that crashed after the rewrite by moving the file", () => {
  const root = consumer();
  put(root, OLD, NEW_CONFIG);
  put(root, "README.md", "Edit repo.config.ts.\n");
  put(root, "packages/api/src/config.ts", "// read from ../../repo.config.ts\n");
  expect(moveOldConfig(root, { check: false })).toStrictEqual({ dir: path.resolve(root), rewritten: [] });
  expect(read(root, NEW)).toBe(NEW_CONFIG);
  expect(fs.existsSync(path.join(root, OLD))).toBe(false);
});

it("outside a git repo still rewrites and moves the config itself", () => {
  const root = consumer({ git: false });
  expect(moveOldConfig(root, { check: false })).toStrictEqual({ dir: path.resolve(root), rewritten: [OLD] });
  expect(read(root, NEW)).toBe(NEW_CONFIG);
  expect(read(root, "README.md")).toBe(DOC);
});

it("under --check names the move and writes nothing", () => {
  const root = consumer();
  const before = snapshot(root);
  expect(moveOldConfig(path.join(root, "packages"), { check: true })).toStrictEqual({
    dir: path.resolve(root),
    error: IS_NOW,
  });
  expect(snapshot(root)).toStrictEqual(before);
});

it("refuses when both files exist and writes nothing", () => {
  const root = consumer();
  put(root, NEW, NEW_CONFIG);
  const before = snapshot(root);

  for (const check of [false, true])
    expect(moveOldConfig(root, { check })).toStrictEqual({ dir: path.resolve(root), error: BOTH });
  expect(snapshot(root)).toStrictEqual(before);
});

it("leaves a repo with only the new file, or none, alone", () => {
  const root = tempDir("workerstack-config-name-");
  expect(moveOldConfig(root, { check: false })).toBeNull();
  put(root, NEW, NEW_CONFIG);
  expect(moveOldConfig(root, { check: false })).toBeNull();
  expect(snapshot(root)).toStrictEqual({ [NEW]: NEW_CONFIG });
});

it("hints the move only where the nearest config is the old one", () => {
  const root = consumer();
  expect(oldConfigHint(path.join(root, "packages", "api"))).toBe(IS_NOW);
  put(root, NEW, NEW_CONFIG);
  expect(oldConfigHint(root)).toBeNull();
  fs.rmSync(path.join(root, OLD));
  expect(oldConfigHint(root)).toBeNull();
  expect(oldConfigHint(tempDir("workerstack-config-name-"))).toBeNull();
});

it("prints the rewrite only when a file changed, then the move", () => {
  const moved = "moved workerstack.config.ts to repo.config.ts";
  expect(moveLines([])).toStrictEqual([moved]);
  expect(moveLines(["a.ts"])).toStrictEqual(["rewrote WorkerstackConfig and workerstack.config.ts in 1 file", moved]);
  expect(moveLines(["a.ts", "b.md"])).toStrictEqual([
    "rewrote WorkerstackConfig and workerstack.config.ts in 2 files",
    moved,
  ]);
});
