import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import {
  exists,
  file,
  fixture,
  generating,
  read,
  snapshot,
  sync,
  syncWith,
  useSyncKit,
  write,
} from "./__fixtures__/sync-kit.ts";
import { MANIFEST_REL } from "./sync/manifest.ts";

useSyncKit();

const NESTED = "ignore rules live in the root .gitignore (or a public package's own); move them there";
const NPM = 'npm reads package.json "files"; delete it';
const NOTHING = "repo sync: nothing written\n";
const DEPS = ["node", "modules"].join("_");
const GIT_DIR = ["", "git"].join(".");

/** The sync fixture as a git repo with a private package `packages/web` beside the public `packages/api`. */
function repoWith(files: Record<string, string>, { git = true } = {}): string {
  const root = fixture();
  write(root, "packages/web/package.json", JSON.stringify({ name: "web", private: true }));
  write(root, "packages/web/references/INDEX.md", "# Web\n");
  for (const [rel, text] of Object.entries(files)) write(root, rel, text);
  if (git) execFileSync("git", ["init", "-q"], { cwd: root });
  return root;
}

it("fails on a .gitignore in a private package and in src/, naming each, and writes nothing", async () => {
  const root = repoWith({ "packages/web/.gitignore": "dist\n", "src/.gitignore": "x\n" });
  const before = snapshot(root);
  expect(await sync(root)).toStrictEqual({
    code: 1,
    stderr: `repo sync: packages/web/.gitignore: ${NESTED}\nrepo sync: src/.gitignore: ${NESTED}\n${NOTHING}`,
    stdout: "",
  });
  expect(snapshot(root)).toStrictEqual(before);
  expect(exists(root, MANIFEST_REL)).toBe(false);
});

it("passes a .gitignore at the root and at a public package root", async () => {
  const root = repoWith({ "packages/api/.gitignore": "dist\n" });
  const { code } = await sync(root);
  expect(code).toBe(0);
});

it("fails on any .npmignore, at the root, in a public package and in a private one", async () => {
  const root = repoWith({ ".npmignore": "a\n", "packages/api/.npmignore": "a\n", "packages/web/.npmignore": "a\n" });
  expect(await sync(root)).toStrictEqual({
    code: 1,
    stderr:
      `repo sync: .npmignore: ${NPM}\n` +
      `repo sync: packages/api/.npmignore: ${NPM}\n` +
      `repo sync: packages/web/.npmignore: ${NPM}\n${NOTHING}`,
    stdout: "",
  });
});

it("scans nothing outside a git repo", async () => {
  const root = repoWith({ ".npmignore": "a\n", "src/.gitignore": "x\n" }, { git: false });
  const { code } = await sync(root);
  expect(code).toBe(0);
});

it("scans nothing when git fails", async () => {
  const root = repoWith({ "src/.gitignore": "x\n" }, { git: false });
  write(root, GIT_DIR, "not a repository\n");
  const { code } = await sync(root);
  expect(code).toBe(0);
});

it("does not scan what git ignores, such as dependencies and an ignored dir", async () => {
  const root = repoWith({
    ".gitignore": `ignored/\n${DEPS}/\n`,
    [`${DEPS}/pkg/.npmignore`]: "a\n",
    "ignored/.gitignore": "x\n",
  });
  const { code } = await sync(root);
  expect(code).toBe(0);
});

it("scans the repo as git sees it once sync wrote the .gitignore block, so a new repo is not deadlocked", async () => {
  const root = repoWith({
    ".tmp/t/.gitignore": "x\n",
    ".worktrees/w/.gitignore": "x\n",
    [`${DEPS}/x/.npmignore`]: "a\n",
  });
  expect(fs.existsSync(path.join(root, ".gitignore"))).toBe(false);
  const { code } = await sync(root);
  expect(code).toBe(0);
  expect(read(root, ".gitignore")).toContain(`${DEPS}/\n`);
});

it("does not report a tracked file that was deleted", async () => {
  const root = repoWith({ "src/.gitignore": "x\n" });
  execFileSync("git", ["add", "src/.gitignore"], { cwd: root });
  fs.rmSync(path.join(root, "src/.gitignore"));
  const { code } = await sync(root);
  expect(code).toBe(0);
});

it("--check fails too, without the closing line", async () => {
  const root = repoWith({ "src/.gitignore": "x\n" });
  expect(await sync(root, "--check")).toStrictEqual({
    code: 1,
    stderr: `repo sync: src/.gitignore: ${NESTED}\n`,
    stdout: "",
  });
});

it("--postinstall prints the lines and exits 0, writing nothing", async () => {
  const root = repoWith({ "src/.gitignore": "x\n" });
  const before = snapshot(root);
  expect(await sync(root, "--postinstall")).toStrictEqual({
    code: 0,
    stderr: `repo sync: src/.gitignore: ${NESTED}\n${NOTHING}`,
    stdout: "",
  });
  expect(snapshot(root)).toStrictEqual(before);
});

it("lists a stray file before an invalid output's problem", async () => {
  const root = repoWith({ "src/.gitignore": "x\n" });
  const bad = {
    formats: [{ comment: null, format: "json" as const, match: () => true }],
    generators: generating(file("bad.json")),
  };
  const result = await syncWith(root, bad);
  expect(result.code).toBe(1);
  expect(result.stderr.split("\n").slice(0, 2)).toStrictEqual([
    `repo sync: src/.gitignore: ${NESTED}`,
    expect.stringMatching(/^repo sync: bad\.json: invalid JSON/),
  ]);
  expect(result.stderr.endsWith(NOTHING)).toBe(true);
});
