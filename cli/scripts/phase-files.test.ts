import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { main } from "./phase-files.ts";

const PLAN = `---
serial: 7
name: x
---

# x

## Steps
1 [ ] Read
1.1 [ ] read it
2 [ ] Command (parallel: src/a.ts, src\\win\\w.ts, src/ren.ts)
2.1 [ ] one
3 [ ] Docs (parallel: docs/b.md, newdir/c.ts)
3.1 [ ] two
4 [ ] Serial
4.1 [ ] three
5 [ ] Later (parallel: later/d.ts)
5.1 [ ] four
6 [ ] More (parallel: later/e.ts)
`;

const tmpDirs: string[] = [];
let main_: string;
let wt: string;
let out: string[];
let err: string[];

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, encoding: "utf8" }).trim();
}

function write(rel: string, text = "x\n") {
  const file = path.join(wt, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function run(...argv: string[]) {
  out = [];
  err = [];
  vi.spyOn(process.stdout, "write").mockImplementation((s) => (out.push(String(s)), true));
  vi.spyOn(process.stderr, "write").mockImplementation((s) => (err.push(String(s)), true));
  const code = main(argv, wt);
  return { code, err: err.join(""), out: out.join("") };
}

beforeEach(() => {
  main_ = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "phase-files-")));
  tmpDirs.push(main_);
  git(main_, "init", "-q", "-b", "main");
  fs.mkdirSync(path.join(main_, "src"), { recursive: true });
  fs.writeFileSync(path.join(main_, "src/a.ts"), "a\n");
  fs.writeFileSync(path.join(main_, "src/old.ts"), "one\ntwo\nthree\nfour\nfive\n");
  fs.mkdirSync(path.join(main_, ".tmp/repo/plans"), { recursive: true });
  fs.writeFileSync(path.join(main_, ".tmp/repo/plans/7-x-20260101T000000Z.md"), PLAN);
  fs.writeFileSync(path.join(main_, ".gitignore"), ".tmp/\n");
  git(main_, "add", "-A");
  git(main_, "commit", "-q", "-m", "init");
  wt = path.join(main_, ".worktrees", "w");
  git(main_, "worktree", "add", "-q", "-b", "wt/w", wt);
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { force: true, recursive: true });
});

describe("phase-files", () => {
  it("lists each phase's changed files, reading the plan from the root", () => {
    write("src/a.ts", "changed\n");
    write("docs/b.md");
    expect(run("7", "2,3")).toStrictEqual({
      code: 0,
      err: "",
      out: "phase 2  src/a.ts\nphase 3  docs/b.md\n",
    });
  });

  it("fails on a file no phase lists", () => {
    write("src/a.ts", "changed\n");
    write("src/new/extra.ts");
    const r = run("7", "2,3");
    expect(r.code).toBe(1);
    expect(r.out).toBe("phase 2  src/a.ts\nphase 3\n");
    expect(r.err).toBe("unowned  src/new/extra.ts  (no phase in 2,3 lists it); send it back as a finding\n");
  });

  it("checks one phase of a group alone", () => {
    write("docs/b.md");
    expect(run("7", "3")).toStrictEqual({ code: 0, err: "", out: "phase 3  docs/b.md\n" });
    write("src/a.ts", "changed\n");
    expect(run("7", "3").code).toBe(1);
  });

  it("names a file in a new directory, not the directory", () => {
    write("newdir/c.ts");
    expect(run("7", "2,3").out).toBe("phase 2\nphase 3  newdir/c.ts\n");
  });
});

describe("phase-files", () => {
  it("takes the new side of an unstaged rename", () => {
    git(wt, "mv", "src/old.ts", "src/ren.ts");
    write("src/ren.ts", "one\ntwo\nthree\nfour\nfive\nsix\n");
    expect(run("7", "2,3")).toStrictEqual({ code: 0, err: "", out: "phase 2  src/ren.ts\nphase 3\n" });
  });

  it("ignores staged changes", () => {
    write("src/a.ts", "changed\n");
    git(wt, "add", "src/a.ts");
    expect(run("7", "2,3")).toStrictEqual({ code: 0, err: "", out: "no unstaged changes\n" });
  });

  it("matches a path declared with backslashes", () => {
    write("src/win/w.ts");
    expect(run("7", "2,3").out).toBe("phase 2  src/win/w.ts\nphase 3\n");
  });

  it("reports nothing changed", () => {
    expect(run("7", "2,3")).toStrictEqual({ code: 0, err: "", out: "no unstaged changes\n" });
  });

  it("accepts a plan path", () => {
    write("docs/b.md");
    const plan = path.join(main_, ".tmp/repo/plans/7-x-20260101T000000Z.md");
    expect(run(plan, "3").out).toBe("phase 3  docs/b.md\n");
  });

  it("rejects a phase that is not parallel", () => {
    expect(run("7", "4")).toMatchObject({
      code: 2,
      err: "phase 4 is not parallel; name phases of one parallel group\n",
    });
  });
});

describe("phase-files", () => {
  it("rejects phases of different groups", () => {
    expect(run("7", "2,5")).toMatchObject({
      code: 2,
      err: "phases 2 and 5 are in different parallel groups; name phases of one group\n",
    });
  });

  it("accepts the second group", () => {
    write("later/d.ts");
    expect(run("7", "5,6").out).toBe("phase 5  later/d.ts\nphase 6\n");
  });

  it("rejects an unknown plan", () => {
    expect(run("99", "2")).toMatchObject({
      code: 2,
      err: `no plan 99 in ${path.join(main_, ".tmp/repo/plans")}\n`,
    });
    expect(run("17", "2").code).toBe(2);
  });

  it("rejects an unknown phase", () => {
    expect(run("7", "9")).toMatchObject({ code: 2, err: "plan 7 has no phase 9\n" });
  });

  it("rejects missing arguments and a missing plan path", () => {
    expect(run("7").code).toBe(2);
    expect(run("7").err).toContain("usage: repo phase-files");
    expect(run("/nope/7-x.md", "2").err).toBe("no plan /nope/7-x.md\n");
  });
});

describe("phase-files", () => {
  it("reports a directory that is not a git repo", () => {
    const plain = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "phase-files-plain-")));
    tmpDirs.push(plain);
    const plan = path.join(main_, ".tmp/repo/plans/7-x-20260101T000000Z.md");
    out = [];
    err = [];
    vi.spyOn(process.stderr, "write").mockImplementation((s) => (err.push(String(s)), true));
    expect(main([plan, "2"], plain)).toBe(2);
    expect(err.join("")).toContain("git status failed");
  });
});
