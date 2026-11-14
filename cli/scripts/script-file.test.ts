import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { plantFiles, useTempDirs } from "../__fixtures__/temp-dirs.ts";
import type { Visited } from "./shell-ast.types.ts";
import { shellFlow } from "./shell-flow.ts";

const { tempDir } = useTempDirs("repo-script-file-");

/** A temp dir holding `files` (relative path to text), by its real path. */
function tree(files: Record<string, string>): string {
  return plantFiles(fs.realpathSync(tempDir()), files);
}

/** A visit as its words and the dir relative to `root`, or `opaque(cause)`. */
function show(v: Visited, root: string, p: typeof path): string {
  if (v.kind === "opaque") return `opaque(${v.cause})`;
  const rel = v.dir.known ? p.relative(root, v.dir.path) : "?";
  const at = rel === "" ? "." : rel;

  return `${v.words.map((w) => w.raw).join(" ")} @${at}`;
}

/** Each command the walk visits from `cwd` with `PATH` set to `pathVar`. */
function visits(src: string, cwd: string, { pathVar = "", p = path } = {}): string[] {
  const out: string[] = [];
  shellFlow(src, { cwd, env: { cdpath: "", home: "/h", path: pathVar }, p }, (v) => out.push(show(v, cwd, p)));

  return out;
}

/** Only the opaque visits of `src` run from `cwd`. */
function opaques(src: string, cwd: string): string[] {
  return visits(src, cwd).filter((v) => v.startsWith("opaque"));
}

describe("script files a shell runs", () => {
  it("walks a file in the run dir in a copy, a name with a slash from the run dir only", () => {
    const r = tree({ "sub/s.sh": "cd ..; git push\n", "x.sh": "cd sub\ngit push\n" });

    expect(visits("bash x.sh; ls", r)).toStrictEqual(["bash x.sh @.", "cd sub @.", "git push @sub", "ls @."]);
    expect(visits("sh sub/s.sh", r)).toStrictEqual(["sh sub/s.sh @.", "cd .. @.", "git push @.."]);
    expect(visits("bash s.sh", path.join(r, "sub"), { pathVar: r })).toStrictEqual([
      "bash s.sh @.",
      "cd .. @.",
      "git push @..",
    ]);
  });

  it("reads the file of a shell behind a runner, and none for a shell name another program takes as a word", () => {
    const r = tree({ "x.sh": "git push\n" });

    expect(visits("timeout 5 bash x.sh", r)).toStrictEqual(["timeout 5 bash x.sh @.", "git push @."]);
    expect(visits("echo sh x.sh; grep -n bash x.sh", r)).toStrictEqual(["echo sh x.sh @.", "grep -n bash x.sh @."]);
  });

  it("looks on PATH when the run dir has no such file, and not for a name with a slash", () => {
    const r = tree({ "bin/y.sh": "git status\n", "bin/z/y.sh": "git log\n" });

    expect(visits("bash y.sh", r, { pathVar: `/nowhere${path.delimiter}${path.join(r, "bin")}` })).toStrictEqual([
      "bash y.sh @.",
      "git status @.",
    ]);
    expect(visits("bash z/y.sh", r, { pathVar: path.join(r, "bin") })).toStrictEqual([
      "bash z/y.sh @.",
      "opaque(z/y.sh)",
    ]);
  });
});

describe("script files a shell cannot read", () => {
  it("reads an absolute file from any dir, and hands on one in an unknown dir", () => {
    const r = tree({ "x.sh": "git push\n" });
    const abs = path.join(r, "x.sh");

    expect(visits(`cd "$D"; bash '${abs}'`, r)).toContain("git push @?");
    expect(visits(`cd "$D"; bash x.sh`, r)).toContain("opaque(x.sh)");
    expect(visits(`bash '${path.join(r, "no.sh")}'`, r)).toContain(`opaque('${path.join(r, "no.sh")}')`);
    expect(visits(`bash "$S"; bash -c 'git log'`, r)).toStrictEqual([
      'bash "$S" @.',
      'opaque("$S")',
      "bash -c 'git log' @.",
      "git log @.",
    ]);
  });

  it("hands on a dir, a file over 256 KiB, and a file it fails to read", () => {
    const r = tree({ "big.sh": "#".repeat(256 * 1024 + 1), "d/k": "", "ok.sh": "true\n" });

    expect(visits("bash d; bash big.sh", r)).toStrictEqual([
      "bash d @.",
      "opaque(d)",
      "bash big.sh @.",
      "opaque(big.sh)",
    ]);
    vi.spyOn(fs, "readFileSync").mockImplementation(() => {
      throw new Error("EACCES");
    });

    expect(visits("bash ok.sh", r)).toStrictEqual(["bash ok.sh @.", "opaque(ok.sh)"]);
  });
});

describe("script files source reads", () => {
  it("walks the file in the caller's state, PATH first and the run dir after", () => {
    const r = tree({ "a.sh": "cd sub\n", "b.sh": "git status\n", "bin/b.sh": "git log\n", "sub/k": "" });
    const pathVar = path.join(r, "bin");

    expect(visits("source a.sh; ls", r)).toStrictEqual(["source a.sh @.", "cd sub @.", "ls @sub"]);
    expect(visits(". -- b.sh", r, { pathVar })).toStrictEqual([". -- b.sh @.", "git log @."]);
    expect(visits("source a.sh", r, { pathVar })).toStrictEqual(["source a.sh @.", "cd sub @."]);
  });

  it("looks on a PATH the line sets", () => {
    const r = tree({ "bin/b.sh": "git log\n" });

    expect(visits(`PATH='${path.join(r, "bin")}'; source b.sh`, r)).toContain("git log @.");
  });

  it("hands on a source when PATH is unknown, which a shell does not need for a file in the run dir", () => {
    const r = tree({ "b.sh": "git status\n" });

    expect(visits('PATH="$X"; source b.sh', r)).toContain("opaque(b.sh)");
    expect(visits('PATH="$X"; bash b.sh', r)).toContain("git status @.");
  });

  it("walks a file that sources itself once", () => {
    const r = tree({ "loop.sh": "source loop.sh\ngit push\n" });

    expect(visits("source loop.sh", r)).toStrictEqual(["source loop.sh @.", "source loop.sh @.", "git push @."]);
  });
});

describe("script files the line writes", () => {
  it("walks the text a cat heredoc or here-string wrote, in place of the file on disk", () => {
    const r = tree({ "x.sh": "true\n" });
    const abs = path.join(r, "y.sh");

    expect(visits("cat > x.sh <<'EOF'\ngit push\nEOF\nbash x.sh", r)).toStrictEqual([
      "cat @.",
      "bash x.sh @.",
      "git push @.",
    ]);
    expect(visits(`cat >| '${abs}' <<< 'git log'; cd "$D"; source '${abs}'`, r)).toContain("git log @?");
  });

  it("hands on a file another write left, a file one branch wrote, and a write the cat does not make", () => {
    const r = tree({ "x.sh": "true\n" });

    expect(opaques("echo hi >> x.sh; bash x.sh", r)).toStrictEqual(["opaque(x.sh)"]);
    expect(opaques("printf 'git push' > x.sh; bash x.sh", r)).toStrictEqual(["opaque(x.sh)"]);
    expect(opaques("cat > x.sh > y.sh <<< 'git log'; bash x.sh; bash y.sh", r)).toStrictEqual(["opaque(x.sh)"]);
    expect(opaques("cat a > x.sh <<< 'git log'; bash x.sh", r)).toStrictEqual(["opaque(x.sh)"]);
    expect(opaques("if true; then cat > x.sh <<< 'git log'; fi; bash x.sh", r)).toStrictEqual(["opaque(x.sh)"]);
    expect(opaques("if true; then :; else cat > x.sh <<< 'git log'; fi; bash x.sh", r)).toStrictEqual(["opaque(x.sh)"]);
    expect(opaques(`cat > x.sh <<< '${"#".repeat(256 * 1024)}'; bash x.sh`, r)).toStrictEqual(["opaque(x.sh)"]);
  });

  it("keeps a file both branches wrote the same, and skips a write it cannot place", () => {
    const r = tree({ "x.sh": "true\n" });
    const both = "if true; then cat > x.sh <<< 'git log'; else cat > x.sh <<< 'git log'; fi; bash x.sh";

    expect(visits(both, r)).toContain("git log @.");
    expect(visits("cat > \"$F\" <<< 'git log'; bash x.sh", r)).toContain("true @.");
    expect(visits(`cd "$D"; cat > x.sh <<< 'git log'; cd '${r}'; bash x.sh`, r)).toContain("true @.");
  });
});

/** The real file a Windows spelling stands for, or one that does not exist. */
function onDisk(disk: ReadonlyMap<string, string>, target: fs.PathOrFileDescriptor): string {
  return disk.get(String(target)) ?? path.join(os.tmpdir(), "repo-script-file-none");
}

describe("script files on Windows", () => {
  it("builds the lookup with the win32 delimiter and separator", () => {
    const r = tree({ "y.sh": "git push\n" });
    const disk = new Map([["C:\\tools\\y.sh", path.join(r, "y.sh")]]);
    const { readFileSync, statSync } = fs;
    vi.spyOn(fs, "statSync").mockImplementation((target) => statSync(onDisk(disk, target), { throwIfNoEntry: false }));
    vi.spyOn(fs, "readFileSync").mockImplementation((target) => readFileSync(onDisk(disk, target), "utf8"));
    const opts = { p: path.win32, pathVar: "C:\\bin;C:\\tools" };

    expect(visits("source y.sh", "C:\\r", opts)).toStrictEqual(["source y.sh @.", "git push @."]);
  });
});
