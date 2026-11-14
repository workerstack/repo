import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { removeTemps } from "../__fixtures__/remove-temps.ts";
import { removeTree } from "../remove-tree.ts";
import { captureMain, gitIn } from "./__fixtures__/git-command-kit.ts";
import { main } from "./slice-files.ts";

const FAST = [
  "---",
  "serial: 2",
  "---",
  "",
  "# x",
  "",
  "## Order",
  "1 [ ] ignore tmp: add .tmp/ to .gitignore (parallel: .gitignore, lib/)",
  "      Location: /x/.repo/plans-fast/1-a-20260101T000000Z.md",
  "2 [ ] glob cli: touch cli scripts (parallel: cli/*.ts, src\\win.ts)",
  "3 [ ] serial: run after",
  "",
  "## Verify",
  "4 [ ] ok",
  "",
].join("\n");

const DEEP = FAST.replace("## Order", "## Order\n").replace("serial: 2", "serial: 5");

const tmpDirs: string[] = [];
let repo: string;
let roadmap: string;

function git(...args: string[]) {
  return gitIn(repo, ...args);
}

function commit(files: Record<string, string>) {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), text);
  }

  git("add", "-A");
  git("commit", "-q", "-m", "x");
}

function run(...argv: string[]) {
  return captureMain(() => main(argv, repo));
}

beforeEach(() => {
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "slice-files-")));
  tmpDirs.push(repo);
  git("init", "-q", "-b", "main");
  roadmap = path.join(repo, ".repo/roadmaps-fast/2-x-20260101T000000Z.md");
  commit({ ".gitignore": "x\n", ".repo/roadmaps-fast/2-x-20260101T000000Z.md": FAST, "old.ts": "one\ntwo\nthree\n" });
  git("checkout", "-q", "-b", "wt/a");
});

afterEach(() => {
  vi.restoreAllMocks();
  removeTemps(tmpDirs.splice(0));
});

describe("slice-files", () => {
  it("owns a listed file and a file under a listed folder", () => {
    commit({ ".gitignore": ".tmp/\n", "lib/deep/y.ts": "y\n" });
    expect(run(roadmap, "1")).toStrictEqual({ code: 0, err: "", out: "slice 1  .gitignore  lib/deep/y.ts\n" });
  });

  it("owns what a glob matches and a backslash entry, and names a file outside the list", () => {
    commit({ "cli/a.ts": "a\n", "cli/b/c.ts": "c\n", "src/win.ts": "w\n" });
    expect(run(roadmap, "2")).toStrictEqual({
      code: 1,
      err: "outside  cli/b/c.ts  (slice 2 does not list it); land this plan last\n",
      out: "slice 2  cli/a.ts  src/win.ts\n",
    });
  });
});

describe("slice-files renames, empty branches and deep roadmaps", () => {
  it("reports a rename by its new path", () => {
    fs.mkdirSync(path.join(repo, "lib"));
    git("mv", "old.ts", "lib/new.ts");
    git("commit", "-q", "-m", "mv");
    expect(run(roadmap, "1").out).toBe("slice 1  lib/new.ts\n");
  });

  it("says when the branch changed nothing", () => {
    expect(run(roadmap, "1")).toStrictEqual({ code: 0, err: "", out: "slice 1  no changes since main\n" });
  });

  it("reads a deep pointer roadmap", () => {
    const deep = path.join(repo, ".repo/roadmaps/5-x-20260101T000000Z.md");
    fs.mkdirSync(path.dirname(deep), { recursive: true });
    fs.writeFileSync(deep, DEEP);
    fs.writeFileSync(path.join(repo, ".gitignore"), ".tmp/\n.repo/roadmaps/\n");
    git("commit", "-q", "-am", "x");
    expect(run(deep, "1").out).toBe("slice 1  .gitignore\n");
  });
});

describe("slice-files refusals", () => {
  it.each([
    { argv: ["x"], err: "usage: repo slice-files <roadmap path> <slice>\n" },
    { argv: ["/nope.md", "1"], err: "no roadmap /nope.md\n" },
    { argv: ["ROADMAP", "7"], err: "roadmap 2 has no slice 7\n" },
    { argv: ["ROADMAP", "3"], err: "slice 3 is not parallel; name a slice of a parallel group\n" },
  ])("refuses $argv", ({ argv, err }) => {
    expect(run(...argv.map((a) => (a === "ROADMAP" ? roadmap : a)))).toStrictEqual({ code: 2, err, out: "" });
  });

  it("names a roadmap with no serial and no Order by its path", () => {
    const notes = path.join(repo, "notes.md");
    fs.writeFileSync(notes, "# notes\n");
    expect(run(notes, "1")).toStrictEqual({ code: 2, err: `roadmap ${notes} has no slice 1\n`, out: "" });
  });

  it("reads the branch in the current folder when no folder is passed", () => {
    vi.spyOn(process, "cwd").mockReturnValue(repo);
    commit({ ".gitignore": ".tmp/\n" });
    expect(captureMain(() => main([roadmap, "1"])).out).toBe("slice 1  .gitignore\n");
  });

  it("refuses when git cannot diff", () => {
    removeTree(path.join(repo, ".git"));
    const r = run(roadmap, "1");
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/^git diff failed in /);
  });
});
