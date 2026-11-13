import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import { bunPath } from "../../dev/test-paths";
import { childEnv } from "../env.ts";
import { tempDir, useTempDirs } from "../sync/__fixtures__/temp-dirs.ts";
import { git } from "./__fixtures__/lessons-kit.ts";

useTempDirs();

const CLI = fileURLToPath(new URL("../../bin/repo.ts", import.meta.url));
const FILE = ".repo/backlog.md";

/** The session variables that would point the CLI at the real checkout, removed. */
function cleanEnv() {
  return childEnv({ CLAUDE_PROJECT_DIR: undefined, GROK_WORKSPACE_ROOT: undefined });
}

/** A committed temp checkout `root` and its linked worktree `wt`, both real paths. */
function checkout() {
  const root = path.join(fs.realpathSync(tempDir("backlog-")), "ws");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "a.txt"), "x\n");
  git(root, "init", "-q");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "init");
  git(root, "worktree", "add", "-q", ".worktrees/w", "-b", "wt/w");

  return { root, wt: path.join(root, ".worktrees/w") };
}

/** `bun repo backlog <args>` run from `cwd`, the session variables unset. */
function run(cwd: string, ...args: string[]) {
  const r = spawnSync(bunPath(), [CLI, "backlog", ...args], { cwd, encoding: "utf8", env: cleanEnv() });

  return { all: r.stdout + r.stderr, code: r.status, err: r.stderr, out: r.stdout };
}

function write(root: string, text: string): void {
  fs.mkdirSync(path.join(root, ".repo"), { recursive: true });
  fs.writeFileSync(path.join(root, FILE), text);
}

function read(root: string): string {
  return fs.readFileSync(path.join(root, FILE), "utf8");
}

const SAMPLE = "- [x] fix the docs link\n- [-] split the sync tests\nnotes\n- [ ] later\n";

it("lists an empty backlog when the file is missing", () => {
  const { root } = checkout();
  const r = run(root);
  expect(r.code).toBe(0);
  expect(r.out).toBe("backlog is empty\n");
});

it("lists an empty backlog when the file is empty", () => {
  const { root } = checkout();
  write(root, "");
  expect(run(root, "list").out).toBe("backlog is empty\n");
});

it("adds a line, creating the file, and prints its path and line number", () => {
  const { root } = checkout();
  const r = run(root, "add", "worktree remove is missing from its usage line");
  expect(r.code).toBe(0);
  expect(r.out).toBe(`${FILE}:1  - [ ] worktree remove is missing from its usage line\n`);
  expect(read(root)).toBe("- [ ] worktree remove is missing from its usage line\n");
});

it("adds after existing lines and reports the new line number", () => {
  const { root } = checkout();
  write(root, "- [ ] a\n- [ ] b\n");
  const r = run(root, "add", "c");
  expect(r.out).toBe(`${FILE}:3  - [ ] c\n`);
  expect(read(root)).toBe("- [ ] a\n- [ ] b\n- [ ] c\n");
});

it("adds from a worktree to the root file, not the worktree's", () => {
  const { root, wt } = checkout();
  const r = run(wt, "add", "probe");
  expect(r.code).toBe(0);
  expect(read(root)).toBe("- [ ] probe\n");
  expect(fs.existsSync(path.join(wt, FILE))).toBe(false);
});

it("lists items open first, then in progress, then done, and counts the lines that are not items", () => {
  const { root } = checkout();
  write(root, SAMPLE);
  const r = run(root);
  expect(r.code).toBe(0);
  expect(r.out).toBe(
    "4  - [ ] later\n2  - [-] split the sync tests\n1  - [x] fix the docs link\n1 lines are not items\n",
  );
});

it("does not count -[ ], [] and [ ]text as items, and counts [X] as done", () => {
  const { root } = checkout();
  write(root, "-[ ] a\n- [] b\n- [ ]c\n- [X] d\n");
  const r = run(root);
  expect(r.out).toBe("4  - [X] d\n3 lines are not items\n");
});

it("marks the item matched by text done and prints the line", () => {
  const { root } = checkout();
  write(root, SAMPLE);
  const r = run(root, "done", "split the sync");
  expect(r.code).toBe(0);
  expect(r.out).toBe(`${FILE}:2  - [x] split the sync tests\n`);
  expect(read(root)).toBe("- [x] fix the docs link\n- [x] split the sync tests\nnotes\n- [ ] later\n");
});

it("marks an item by line number in progress, printing the [-] line", () => {
  const { root } = checkout();
  write(root, SAMPLE);
  const r = run(root, "start", "4");
  expect(r.code).toBe(0);
  expect(r.out).toBe(`${FILE}:4  - [-] later\n`);
  expect(read(root)).toBe("- [x] fix the docs link\n- [-] split the sync tests\nnotes\n- [-] later\n");
});

it("keeps bullet, indent and text when changing a box", () => {
  const { root } = checkout();
  write(root, "  * [ ] indented  text\n");
  run(root, "done", "1");
  expect(read(root)).toBe("  * [x] indented  text\n");
});

it("says a done item is already done and leaves the file alone", () => {
  const { root } = checkout();
  write(root, SAMPLE);
  const r = run(root, "done", "1");
  expect(r.code).toBe(0);
  expect(r.out).toBe("line 1 is already done\n");
  expect(read(root)).toBe(SAMPLE);
});

it("refuses a line number past the end with exit 1", () => {
  const { root } = checkout();
  write(root, SAMPLE);
  const r = run(root, "done", "9");
  expect(r.code).toBe(1);
  expect(r.all).toContain("no line 9 in .repo/backlog.md");
  expect(read(root)).toBe(SAMPLE);
});

it("refuses a line that is not an item with exit 1", () => {
  const { root } = checkout();
  write(root, SAMPLE);
  const r = run(root, "start", "3");
  expect(r.code).toBe(1);
  expect(r.all).toContain("line 3 is not an item");
  expect(read(root)).toBe(SAMPLE);
});

it("refuses text that matches more than one item and names the lines", () => {
  const { root } = checkout();
  const text = "- [ ] a\n- [ ] sync one\n- [ ] b\n- [ ] one sync two\n";
  write(root, text);
  const r = run(root, "done", "sync");
  expect(r.code).toBe(1);
  expect(r.all).toContain('"sync" matches lines 2, 4; pick one');
  expect(read(root)).toBe(text);
});

it("clear asks for --yes and deletes nothing without it", () => {
  const { root } = checkout();
  write(root, "- [x] a\n- [ ] b\n- [X] c\n");
  const r = run(root, "clear");
  expect(r.code).toBe(0);
  expect(r.out).toBe("delete 2 done lines? rerun with --yes\n");
  expect(read(root)).toBe("- [x] a\n- [ ] b\n- [X] c\n");
});

it("clear --yes deletes only the done item lines", () => {
  const { root } = checkout();
  write(root, "# notes\n- [x] a\n- [ ] b\n- [X] c\n- [-] d\n");
  const r = run(root, "clear", "--yes");
  expect(r.code).toBe(0);
  expect(r.out).toBe("deleted 2 done lines\n");
  expect(read(root)).toBe("# notes\n- [ ] b\n- [-] d\n");
});

it("exits 2 with the usage line on an unknown verb", () => {
  const { root } = checkout();
  const r = run(root, "frob");
  expect(r.code).toBe(2);
  expect(r.all).toContain("usage: repo backlog [list] | add <text> | start <N|text> | done <N|text> | clear [--yes]");
});

it("keeps CRLF line endings when changing a box", () => {
  const { root } = checkout();
  write(root, "- [ ] a\r\n- [ ] b\r\n");
  run(root, "done", "b");
  expect(read(root)).toBe("- [ ] a\r\n- [x] b\r\n");
});

it("adds a newline before appending to a file that lacks a trailing one, keeping the rest", () => {
  const { root } = checkout();
  write(root, "- [ ] a\n- [ ] b");
  const r = run(root, "add", "c");
  expect(r.out).toBe(`${FILE}:3  - [ ] c\n`);
  expect(read(root)).toBe("- [ ] a\n- [ ] b\n- [ ] c\n");
});

it("keeps a missing trailing newline when changing a box on the last line", () => {
  const { root } = checkout();
  write(root, "- [ ] a\n- [ ] b");
  run(root, "done", "2");
  expect(read(root)).toBe("- [ ] a\n- [x] b");
});

function start(cwd: string, text: string): Promise<number | null> {
  return new Promise((resolve) => {
    const p = spawn(bunPath(), [CLI, "backlog", "add", text], { cwd, env: cleanEnv(), stdio: "ignore" });

    p.on("close", resolve);
  });
}

it("lands both of two add runs started at once", async () => {
  const { root, wt } = checkout();
  write(root, "- [ ] seed\n");

  const codes = await Promise.all([start(root, "from root"), start(wt, "from worktree")]);
  expect(codes).toStrictEqual([0, 0]);
  const lines = read(root).split("\n");
  expect(lines).toHaveLength(4);
  expect(lines.slice(0, 1)).toStrictEqual(["- [ ] seed"]);
  expect(lines.slice(1, 3).toSorted()).toStrictEqual(["- [ ] from root", "- [ ] from worktree"]);
  expect(lines[3]).toBe("");
});
