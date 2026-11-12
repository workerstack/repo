import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { useTempTree } from "./__fixtures__/temp-tree.ts";
import { main, renameFixtures } from "./fixtures-rename.ts";

const plant = useTempTree("fixtures-rename-");

const READ_ONLY = 0o444;
const BINARY = Buffer.from([0x61, 0x00, 0x2e, 0x2f, 0x66, 0x69, 0x78, 0x74, 0x75, 0x72, 0x65, 0x73, 0x2f]);
const NOT_UTF8 = Buffer.concat([Buffer.from("./fixtures/x.json "), Buffer.from([0xff, 0xfe])]);
const OTHER_TS = 'export const other = ["b/fixtures/x.json", path.join(dir, "fixtures")];\n';
const ROOT_MD = "see a/fixtures/x.json\n";
const PLAN = "a/fixtures -> a/__fixtures__ (2 references in 2 files)";
const BARE_TS = 'export const bare = path.join(here, "fixtures/x.json");\n';
const UP_TS = 'export const up = path.join(import.meta.dirname, "..", "fixtures");\n';
const ROOTED_TS = 'export const rooted = path.join(root, "a", "fixtures", "x.json");\n';
const STOCK_HISTORY = '{\n  "a/fixtures/x.json": ["abc"]\n}\n';
const T_TS = '// the fixtures hold sample data\nimport x from "./fixtures/x.json";\n\nexport default x;\n';
const U_TS = 'import path from "node:path";\n\nexport const p = (dir: string) => path.join(dir, "fixtures");\n';
const V_TS = 'export const name = "fixtures";\n';
const W_TS = 'export type Command = "check" | "fixtures";\n';

/** A temp git repo with a fixture folder, its references and the files the rewrite must leave alone. */
function repo(extra: Record<string, string> = {}): string {
  const dir = plant({
    ...extra,
    "a/deep/v.ts": V_TS,
    "a/fixtures/x.json": "{}\n",
    "a/t.ts": T_TS,
    "a/u.ts": U_TS,
    "a/w.ts": W_TS,
    "cli/sync/stock-history.json": STOCK_HISTORY,
  });

  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["add", "-A"], { cwd: dir });

  return dir;
}

/** The text of `rel` under `dir`. */
function read(dir: string, rel: string): string {
  return fs.readFileSync(path.join(dir, rel), "utf8");
}

describe("fixtures rename, dry run", () => {
  it("prints the plan with the counts it would rewrite and changes nothing", () => {
    const dir = repo();
    expect(renameFixtures(dir, { fix: false })).toStrictEqual([
      "a/fixtures -> a/__fixtures__ (2 references in 2 files)",
    ]);
    expect(fs.existsSync(path.join(dir, "a/fixtures/x.json"))).toBe(true);
    expect(read(dir, "a/t.ts")).toBe(T_TS);
  });
});

describe("fixtures rename --fix", () => {
  it("moves the folder with git and reports the totals", () => {
    const dir = repo();
    expect(renameFixtures(dir, { fix: true })).toStrictEqual(["renamed 1 folder, rewrote 2 references in 2 files"]);
    expect(fs.existsSync(path.join(dir, "a/fixtures"))).toBe(false);
    expect(read(dir, "a/__fixtures__/x.json")).toBe("{}\n");
    const status = execFileSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" });
    expect(status).toContain("a/__fixtures__/x.json");
  });

  it("finds nothing to rename on the next run", () => {
    const dir = repo();
    renameFixtures(dir, { fix: true });
    expect(renameFixtures(dir, { fix: false })).toStrictEqual(["no fixture folders to rename"]);
  });
});

describe("fixtures rename --fix, what it rewrites", () => {
  it("rewrites the import and the sibling path.join argument", () => {
    const dir = repo();
    renameFixtures(dir, { fix: true });
    expect(read(dir, "a/t.ts")).toContain('from "./__fixtures__/x.json"');
    expect(read(dir, "a/u.ts")).toContain('path.join(dir, "__fixtures__")');
  });

  it("rewrites a quoted name whose preceding quoted segments lead to the parent, from the root or the file", () => {
    const dir = repo({ "a/deep/x.ts": UP_TS, "b/y.ts": ROOTED_TS });
    renameFixtures(dir, { fix: true });
    expect(read(dir, "a/deep/x.ts")).toContain('path.join(import.meta.dirname, "..", "__fixtures__")');
    expect(read(dir, "b/y.ts")).toContain('path.join(root, "a", "__fixtures__", "x.json")');
  });

  it("reads a bare path as relative to the root or to the file", () => {
    const dir = repo({ "a/s.ts": BARE_TS });
    renameFixtures(dir, { fix: true });
    expect(read(dir, "a/s.ts")).toContain('path.join(here, "__fixtures__/x.json")');
  });
});

describe("fixtures rename --fix, what it leaves", () => {
  it("leaves a quoted name deeper than the parent, the comment word and the stock-history key", () => {
    const dir = repo();
    renameFixtures(dir, { fix: true });
    expect(read(dir, "a/deep/v.ts")).toBe(V_TS);
    expect(read(dir, "a/t.ts")).toContain("// the fixtures hold sample data");
    expect(read(dir, "cli/sync/stock-history.json")).toBe(STOCK_HISTORY);
  });

  it("leaves a sibling's quoted name that is not a call argument", () => {
    const dir = repo();
    renameFixtures(dir, { fix: true });
    expect(read(dir, "a/w.ts")).toBe(W_TS);
  });

  it("leaves a read-only file, which sync writes from its source", () => {
    const dir = repo();
    const generated = path.join(dir, "a/generated.md");
    fs.writeFileSync(generated, "see ./fixtures/x.json\n");
    fs.chmodSync(generated, READ_ONLY);
    execFileSync("git", ["add", "-A"], { cwd: dir });
    expect(renameFixtures(dir, { fix: true })).toStrictEqual(["renamed 1 folder, rewrote 2 references in 2 files"]);
    expect(read(dir, "a/generated.md")).toBe("see ./fixtures/x.json\n");
  });
});

describe("fixtures rename, what it never reads", () => {
  it("leaves a binary file and a file that is not UTF-8", () => {
    const dir = repo();
    fs.writeFileSync(path.join(dir, "a/bin.dat"), BINARY);
    fs.writeFileSync(path.join(dir, "a/latin.txt"), NOT_UTF8);
    execFileSync("git", ["add", "-A"], { cwd: dir });
    expect(renameFixtures(dir, { fix: true })).toStrictEqual(["renamed 1 folder, rewrote 2 references in 2 files"]);
    expect(fs.readFileSync(path.join(dir, "a/bin.dat"))).toStrictEqual(BINARY);
    expect(fs.readFileSync(path.join(dir, "a/latin.txt"))).toStrictEqual(NOT_UTF8);
  });

  it("leaves a path and an argument that lead to another folder's fixtures", () => {
    const dir = repo({ "a/deep/z.ts": OTHER_TS });
    renameFixtures(dir, { fix: true });
    expect(read(dir, "a/deep/z.ts")).toBe(OTHER_TS);
  });

  it("rewrites a root file's path from the root", () => {
    const dir = repo({ "README.md": ROOT_MD });
    renameFixtures(dir, { fix: true });
    expect(read(dir, "README.md")).toBe("see a/__fixtures__/x.json\n");
  });
});

describe("fixtures rename, a taken name", () => {
  it("skips a folder whose new name exists, and one an earlier folder takes", () => {
    const dir = repo({ "a/__fixtures__/y.json": "{}\n", "b/fixture/x.json": "{}\n", "b/fixtures/x.json": "{}\n" });
    expect(renameFixtures(dir, { fix: true })).toStrictEqual([
      "renamed 1 folder, rewrote 0 references in 0 files",
      "a/fixtures -> a/__fixtures__ (skipped: a/__fixtures__ exists)",
      "b/fixtures -> b/__fixtures__ (skipped: b/__fixtures__ exists)",
    ]);
    expect(fs.existsSync(path.join(dir, "a/fixtures/x.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "b/__fixtures__/x.json"))).toBe(true);
  });
});

/** Runs `main` on `argv` in `dir`, and what it printed to stdout and stderr. */
function run(dir: string, argv: string[]) {
  vi.restoreAllMocks();
  vi.spyOn(process, "cwd").mockReturnValue(dir);
  const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  const code = main(argv);

  return { code, err: err.mock.calls.join(""), out: out.mock.calls.join("") };
}

describe("repo fixtures", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refuses an argument it does not take with the usage line and exit 2", () => {
    expect(run(repo(), ["--force"])).toStrictEqual({ code: 2, err: "usage: repo fixtures [--fix]\n", out: "" });
  });

  it("prints the plan without --fix and applies it with --fix", () => {
    const dir = repo();
    expect(run(dir, [])).toStrictEqual({ code: 0, err: "", out: `${PLAN}\n` });
    expect(run(dir, ["--fix"]).out).toBe("renamed 1 folder, rewrote 2 references in 2 files\n");
  });
});
