import { execFileSync } from "node:child_process";

import { afterAll, expect, it, vi } from "vitest";

import { file, fixture, only, snapshot, syncWith, useSyncKit, write } from "./__fixtures__/sync-kit.ts";
import { tracked } from "./sync/__fixtures__/adoption-kit.ts";
import { copied, dropFixture, plain, sync as fullSync } from "./sync/__fixtures__/copied-install.ts";
import { useTempDirs } from "./sync/__fixtures__/temp-dirs.ts";
import { gitFiles } from "./sync/git-files.ts";

useSyncKit();

useTempDirs();

afterAll(dropFixture);

vi.setConfig({ testTimeout: 120_000 });

const NOTHING = "repo sync: nothing written\n";
const GIT_DIR = ["", "git"].join(".");

/** The sync fixture as a git repo that tracks `forced`, written and added with `git add -f`. */
function repoTracking(forced: string[], { git = true } = {}): string {
  const root = fixture();

  for (const rel of forced) write(root, rel, `${rel}\n`);

  if (git) {
    execFileSync("git", ["init", "-q"], { cwd: root });

    if (forced.length > 0) execFileSync("git", ["add", "-f", ...forced], { cwd: root });
  }

  return root;
}

/** What `repo sync --check` prints for `root` with these outputs. */
async function checked(root: string, outputs: string[]): Promise<string> {
  const result = await sync(root, outputs, "--check");

  return result.stderr;
}

/** The exit code of a sync of `root` with these outputs. */
async function codeOf(root: string, outputs: string[], ...args: string[]): Promise<number> {
  const result = await sync(root, outputs, ...args);

  return result.code;
}

/** A `repo sync:` line for a block line, with its reason and the command to run. */
function line(name: string, reason: string, fix: string): string {
  return `repo sync: ${name}: git tracks ${reason}; run \`git rm ${fix}\``;
}

/** Syncs `root` with these whole untracked outputs and the git files pass, which writes the ignore block. */
function sync(root: string, outputs: string[], ...args: string[]) {
  return syncWith(root, { ...only(...outputs.map((rel) => file(rel))), post: [gitFiles] }, ...args);
}

function untrack(root: string, ...args: string[]): void {
  execFileSync("git", ["rm", "-q", "--cached", ...args], { cwd: root });
}

function hostFiles(root: string): string[] {
  return tracked(root).filter((rel) => rel.startsWith(".claude/"));
}

/** Syncs a committed install with a tracked host dir; whether the check refused it, the code and what stays tracked. */
async function syncedInstall(root: string) {
  const result = await fullSync(root, [], true);

  return { code: result.code, left: hostFiles(root), refused: result.err.join("").includes("git tracks") };
}

const KNIP_LINE = line("knip.json", "it, but sync keeps it untracked", "--cached knip.json");

it("fails on a force-added untracked output and writes nothing, then passes once untracked", async () => {
  const root = repoTracking(["knip.json"]);
  const before = snapshot(root);

  expect(await sync(root, ["knip.json"])).toStrictEqual({ code: 1, stderr: `${KNIP_LINE}\n${NOTHING}`, stdout: "" });
  expect(snapshot(root)).toStrictEqual(before);

  untrack(root, "knip.json");
  expect(await codeOf(root, ["knip.json"])).toBe(0);
  expect(await codeOf(root, ["knip.json"], "--check")).toBe(0);
});

it("--check fails on it too, without the closing line", async () => {
  const root = repoTracking(["knip.json"]);

  expect(await sync(root, ["knip.json"], "--check")).toStrictEqual({ code: 1, stderr: `${KNIP_LINE}\n`, stdout: "" });
});

it("groups the tracked files under an ignored host dir in one line", async () => {
  const outputs = [".claude/agents/a.md", ".claude/agents/b.md", ".claude/rules/c.md"];
  const root = repoTracking(outputs);
  const reason = "3 files under it, but sync keeps them untracked";

  expect(await checked(root, outputs)).toBe(`${line(".claude/", reason, "-r --cached .claude/")}\n`);
});

it("says one file when a host dir holds one tracked file", async () => {
  const root = repoTracking([".claude/agents/a.md"]);
  const reason = "1 file under it, but sync keeps it untracked";

  expect(await checked(root, [".claude/agents/a.md"])).toBe(`${line(".claude/", reason, "-r --cached .claude/")}\n`);
});

it("names the files a line with a star matches, one line per block line in block order", async () => {
  const root = repoTracking([
    "knip.json",
    "knip.unignored-a.json",
    "knip.unignored-b.json",
    ".repo/plans/one.md",
    ".claude/agents/a.md",
  ]);

  const one = "1 file that matches it, but sync keeps it untracked";
  const plans = line("**/.repo/plans/", one, "--cached .repo/plans/one.md");
  const both = "2 files that match it, but sync keeps them untracked";
  const unignored = line("knip.unignored-*.json", both, "--cached knip.unignored-a.json knip.unignored-b.json");
  const dir = line(".claude/", "1 file under it, but sync keeps it untracked", "-r --cached .claude/");

  expect(await checked(root, ["knip.json", ".claude/agents/a.md"])).toBe(
    [plans, KNIP_LINE, unignored, dir, ""].join("\n"),
  );
});

it("passes when git tracks nothing the block covers", async () => {
  const root = repoTracking([]);
  expect(await codeOf(root, ["knip.json"])).toBe(0);
});

it("passes a copied install with a tracked .claude/, which migration untracks", async () => {
  const root = copied();

  expect(hostFiles(root)).not.toStrictEqual([]);
  expect(await syncedInstall(root)).toStrictEqual({ code: 0, left: [], refused: false });
});

it("passes an adopting install with a tracked .claude/, which adoption untracks", async () => {
  const settings = JSON.stringify({ permissions: { allow: ["Bash(make lint:*)"] } });

  const root = plain({ ".claude/settings.json": settings });

  expect(hostFiles(root)).toStrictEqual([".claude/settings.json"]);
  expect(await syncedInstall(root)).toStrictEqual({ code: 0, left: [], refused: false });
});

it("checks nothing outside a git repo", async () => {
  const root = repoTracking(["knip.json"], { git: false });
  expect(await codeOf(root, ["knip.json"])).toBe(0);
});

it("checks nothing when git fails on a broken git file", async () => {
  const root = repoTracking(["knip.json"], { git: false });
  write(root, GIT_DIR, "gitdir: /nonexistent\n");
  expect(await codeOf(root, ["knip.json"])).toBe(0);
});
