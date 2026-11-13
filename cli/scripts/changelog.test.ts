import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { tempDir, useTempDirs } from "../sync/__fixtures__/temp-dirs.ts";
import { FILLED, OLDER, plantRepo, runChangelog, stagedNames, type RepoOptions } from "./__fixtures__/changelog-kit.ts";
import { git } from "./__fixtures__/lessons-kit.ts";
import { USAGE } from "./changelog.constants.ts";

useTempDirs();

const PKG = "packages/pub/CHANGELOG.md";
const run = runChangelog;

/** A temp git repo of `files` over a public root package and a public `packages/pub`. */
function repo(files: Record<string, string> = {}, options: RepoOptions = {}) {
  const root = path.join(fs.realpathSync(tempDir("changelog-")), "ws");

  fs.mkdirSync(root, { recursive: true });
  plantRepo(root, files, options);

  return root;
}

function read(root: string, file: string): string {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function touch(root: string, file: string): void {
  fs.writeFileSync(path.join(root, file), "changed\n");
}

it("prints only the Unreleased section of the owner's changelog", () => {
  const root = repo();
  expect(run(root, "--dir", ".")).toStrictEqual({
    code: 0,
    err: "",
    out: "## [Unreleased]\n\n### Added\n\n- a\n",
  });
});

it("says an empty Unreleased is empty", () => {
  const root = repo();
  expect(run(root, "--dir", "packages/pub")).toStrictEqual({
    code: 0,
    err: "",
    out: "[Unreleased] in packages/pub/CHANGELOG.md is empty\n",
  });
  expect(run(root, "--dir", "packages/pub/")).toMatchObject({ code: 0 });
});

it("prints the root changelog in a clean tree and whatever is staged, with no owner lookup", () => {
  const root = repo();
  const printed = { code: 0, err: "", out: "## [Unreleased]\n\n### Added\n\n- a\n" };
  expect(run(root)).toStrictEqual(printed);
  touch(root, "packages/pub/x.ts");
  git(root, "add", "packages/pub/x.ts");
  expect(run(root)).toStrictEqual(printed);
});

it("adds the entry for the owner of the staged files and stages the changelog", () => {
  const root = repo();
  touch(root, "x.ts");
  git(root, "add", "x.ts");
  const got = run(root, "add", "Fixed", "`repo sync` keeps a hand-set key.");
  expect(got).toStrictEqual({
    code: 0,
    err: "",
    out: "CHANGELOG.md:11  - `repo sync` keeps a hand-set key.\nstaged CHANGELOG.md\n",
  });
  expect(read(root, "CHANGELOG.md")).toBe(
    FILLED.replace("\n## [0.1.0]", "\n### Fixed\n\n- `repo sync` keeps a hand-set key.\n\n## [0.1.0]"),
  );
  expect(stagedNames(root)).toStrictEqual(["CHANGELOG.md", "x.ts"]);
});

it("adds to the package of the staged files, not the root", () => {
  const root = repo();
  touch(root, "packages/pub/x.ts");
  git(root, "add", "packages/pub/x.ts");
  const got = run(root, "add", "Added", "one", "thing");
  expect(got.out).toBe("packages/pub/CHANGELOG.md:7  - one thing\nstaged packages/pub/CHANGELOG.md\n");
  expect(read(root, "CHANGELOG.md")).toBe(FILLED);
  expect(read(root, PKG)).toContain("### Added\n\n- one thing\n");
});

it("adds for the changed owner and stages nothing when no file is staged", () => {
  const root = repo();
  touch(root, "packages/pub/x.ts");
  fs.writeFileSync(path.join(root, "packages/pub/new.ts"), "n\n");
  const got = run(root, "add", "Added", "b");
  expect(got).toStrictEqual({ code: 0, err: "", out: "packages/pub/CHANGELOG.md:7  - b\n" });
  expect(stagedNames(root)).toStrictEqual([]);
});

it("finds the changed owner of a repo with no commit yet", () => {
  const root = repo({}, { commit: false });
  const got = run(root, "add", "Added", "b");
  expect(got.code).toBe(1);
  expect(got.err).toContain("the changed files span ., packages/pub; pass --dir <package dir>");
  expect(stagedNames(root)).toStrictEqual([]);
});

it("adds in a repo with no commit yet, with the owner changed and then staged", () => {
  const root = repo({}, { commit: false, pub: false });
  expect(run(root, "add", "Added", "b")).toStrictEqual({ code: 0, err: "", out: "CHANGELOG.md:8  - b\n" });
  git(root, "add", "x.ts");
  expect(run(root, "add", "Fixed", "c").out).toBe("CHANGELOG.md:12  - c\nstaged CHANGELOG.md\n");
});

it("finds no owner in a CHANGELOG.md alone", () => {
  const root = repo({}, { pub: false });
  fs.writeFileSync(path.join(root, "CHANGELOG.md"), `${FILLED}\n`);
  expect(run(root, "add", "Added", "b")).toMatchObject({ code: 1, out: "" });
});

it("counts a renamed file by its new path only", () => {
  const root = repo({ "priv/package.json": JSON.stringify({ name: "priv", private: true }) }, { rootPublic: false });
  git(root, "mv", "packages/pub/x.ts", "priv/x.ts");
  const refused = run(root, "add", "Added", "b");
  expect(refused.code).toBe(1);
  expect(refused.err).toContain("no staged or changed");
  git(root, "mv", "x.ts", "packages/pub/z.ts");
  expect(run(root, "add", "Added", "b").out).toContain("packages/pub/CHANGELOG.md:7  - b\n");
});

it("takes --dir over any staged file and stages nothing", () => {
  const root = repo();
  touch(root, "x.ts");
  git(root, "add", "x.ts");
  const got = run(root, "add", "Added", "b", "--dir", "packages/pub");
  expect(got).toStrictEqual({ code: 0, err: "", out: "packages/pub/CHANGELOG.md:7  - b\n" });
  expect(stagedNames(root)).toStrictEqual(["x.ts"]);
});

it("refuses a section that is not one of the six, exit 2", () => {
  const root = repo();
  expect(run(root, "add", "Fixes", "x")).toStrictEqual({
    code: 2,
    err: "section must be Added, Changed, Deprecated, Removed, Fixed or Security\n",
    out: "",
  });
});

it("refuses an entry of more than one line, exit 2", () => {
  const root = repo();
  expect(run(root, "add", "Added", "a\nb", "--dir", ".")).toStrictEqual({
    code: 2,
    err: "the entry is one line\n",
    out: "",
  });
});

it.each([
  ["frob"],
  ["add"],
  ["add", "Added"],
  ["add", "Added", "  "],
  ["--dir"],
  ["--dir", "a", "b"],
  ["--dir", "a", "--dir", "b"],
  ["add", "--dir"],
])("prints the usage and exits 2 for %j", (...args) => {
  expect(run(repo(), ...args)).toStrictEqual({ code: 2, err: `${USAGE}\n`, out: "" });
});

it("refuses a --dir outside the checkout, exit 2", () => {
  const got = run(repo(), "--dir", "..");
  expect(got).toMatchObject({ code: 2, out: "" });
  expect(got.err).toContain("--dir must be inside the checkout");
});

it("refuses when no staged or changed file is in a public package, exit 1", () => {
  const root = repo({}, { rootPublic: false });
  touch(root, "x.ts");
  expect(run(root, "add", "Added", "x")).toStrictEqual({
    code: 1,
    err: "no staged or changed file is in a public package; pass --dir <package dir>\n",
    out: "",
  });
});

it("refuses when the staged files span more than one public package, exit 1", () => {
  const root = repo();
  touch(root, "x.ts");
  touch(root, "packages/pub/x.ts");
  git(root, "add", "-A");
  expect(run(root, "add", "Added", "x")).toStrictEqual({
    code: 1,
    err: "the staged files span ., packages/pub; pass --dir <package dir>\n",
    out: "",
  });
  expect(read(root, "CHANGELOG.md")).toBe(FILLED);
});

it("refuses a --dir with no CHANGELOG.md, exit 1", () => {
  const root = repo({ "lib/package.json": JSON.stringify({ name: "lib" }) });
  expect(run(root, "add", "Added", "x", "--dir", "lib")).toStrictEqual({
    code: 1,
    err: "lib/CHANGELOG.md is missing; add one in the Keep a Changelog format\n",
    out: "",
  });
  expect(run(root, "--dir", "lib").code).toBe(1);
});

it("refuses a --dir whose changelog has no Unreleased, exit 1", () => {
  const root = repo({ "lib/CHANGELOG.md": `# Changelog\n\n${OLDER}` });
  expect(run(root, "add", "Added", "x", "--dir", "lib")).toStrictEqual({
    code: 1,
    err: "lib/CHANGELOG.md has no ## [Unreleased] section; add it above the newest version\n",
    out: "",
  });
});

it("exits 1 with git's message outside a repository", () => {
  const dir = fs.realpathSync(tempDir("changelog-nogit-"));
  const got = run(dir, "add", "Added", "x");
  expect(got.code).toBe(1);
  expect(got.out).toBe("");
});
