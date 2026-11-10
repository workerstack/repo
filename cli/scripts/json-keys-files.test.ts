import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { cleanJsonDirs, ignoreConfig, jsonDir, readText, SORTED, UNSORTED } from "./fixtures/json-dirs.ts";
import { repoJson, sortJson } from "./json-keys.ts";

afterEach(() => {
  vi.unstubAllEnvs();
  cleanJsonDirs();
});

/** A repo with committed json files, one of them deleted since, one ignored, one untracked. */
function committed(): string {
  const files = {
    ".gitignore": "ignored.json\n",
    "a.json": "{}\n",
    "nested/b.json": "{}\n",
    "nested/deep/c.json": "{}\n",
  };
  const root = jsonDir({
    ...files,
    "other/d.json": "{}\n",
    "conf/e.jsonc": "{}\n",
    "gone.json": "{}\n",
    "ignored.json": "{}\n",
    "x.txt": "x\n",
  });
  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--no-verify", "-m", "i"], {
    cwd: root,
  });
  fs.rmSync(path.join(root, "gone.json"));
  fs.mkdirSync(path.join(root, "fresh"));
  fs.writeFileSync(path.join(root, "fresh/e.json"), "{}\n");
  return root;
}

it("lists tracked and untracked unignored json and jsonc files as root-relative paths, without a deleted one", () => {
  expect(repoJson(committed(), null)).toEqual({
    ok: true,
    files: ["a.json", "conf/e.jsonc", "fresh/e.json", "nested/b.json", "nested/deep/c.json", "other/d.json"],
  });
});

it("narrows to a file, a folder and the root, by the paths given", () => {
  const root = committed();
  expect(repoJson(root, ["nested"])).toEqual({ ok: true, files: ["nested/b.json", "nested/deep/c.json"] });
  expect(repoJson(root, ["a.json", "other/d.json"])).toEqual({ ok: true, files: ["a.json", "other/d.json"] });
  expect(repoJson(root, ["nest"])).toEqual({ ok: true, files: [] });
  expect(repoJson(root, [""]).files).toHaveLength(6);
});

it("lists under a hook's GIT_* variables, which would aim git at another repo, and keeps GIT_CONFIG_*", () => {
  const root = committed();
  vi.stubEnv("GIT_DIR", path.join(os.tmpdir(), "workerstack-no-such-git-dir"));
  vi.stubEnv("GIT_CONFIG_COUNT", "0");
  expect(repoJson(root, ["a.json"])).toEqual({ ok: true, files: ["a.json"] });
});

it("lists nothing, without an error, when git is not there to run", () => {
  const notThere = () => ({ status: null, stdout: "" });
  expect(repoJson(committed(), null, notThere)).toEqual({ ok: true, files: [] });
});

it("lists nothing, without an error, when the root is not a git repo", () => {
  expect(repoJson(jsonDir({ "a.json": "{}\n" }, false), null)).toEqual({ ok: true, files: [] });
});

const IGNORES = ["/gen.json", "**/fixtures/**", "plain.json", "**/*.md"];
const LEFT = ["package.json", "pkgs/package.json"];
const COMMENTED = '{\n  // keep\n  "b": 1,\n  "a": 2\n}\n';
const COMMENTED_SORTED = '{\n  "a": 2,\n  // keep\n  "b": 1\n}\n';
const SORTABLE = (tree: Record<string, string>): string[] => Object.keys(tree).filter((f) => f !== ".oxfmtrc.jsonc");
const TREE = {
  ".oxfmtrc.jsonc": ignoreConfig(IGNORES),
  "gen.json": UNSORTED,
  "sub/gen.json": UNSORTED,
  "plain.json": UNSORTED,
  "a/b/plain.json": UNSORTED,
  "fixtures/f.json": UNSORTED,
  "x/fixtures/y/f.json": UNSORTED,
  "mypackage.json": UNSORTED,
  "data.json": UNSORTED,
  "sorted.json": SORTED,
  "package.json": '{"version":"1","name":"x"}\n',
  "pkgs/package.json": '{"version":"1","name":"x"}\n',
  "comments.json": COMMENTED,
  "conf/app.jsonc": COMMENTED,
  "conf/fixtures/app.jsonc": COMMENTED,
  "notes.txt": UNSORTED,
};

it("sorts the json files the config does not ignore, an anchored and an unanchored pattern's files left alone", () => {
  const root = jsonDir(TREE);
  const found = ["sub/gen.json", "mypackage.json", "data.json"].map((file) => ({ file, key: "hooks" }));
  const commented = ["comments.json", "conf/app.jsonc"].map((file) => ({ file, key: "a" }));
  expect(sortJson(root, SORTABLE(TREE), false)).toEqual({ ok: true, found: [...found, ...commented] });
  for (const file of found.map((entry) => entry.file)) expect(readText(root, file)).toBe(SORTED);
  for (const file of commented.map((entry) => entry.file)) expect(readText(root, file)).toBe(COMMENTED_SORTED);
  expect(readText(root, "conf/fixtures/app.jsonc")).toBe(COMMENTED);
  for (const left of [
    "gen.json",
    "plain.json",
    "a/b/plain.json",
    "fixtures/f.json",
    "x/fixtures/y/f.json",
    "notes.txt",
  ])
    expect(readText(root, left)).toBe(UNSORTED);
});

it("leaves package.json to oxfmt", () => {
  const root = jsonDir(TREE);
  sortJson(root, SORTABLE(TREE), false);
  for (const [left, text] of Object.entries(TREE).filter(([file]) => LEFT.includes(file)))
    expect(readText(root, left)).toBe(text);
});

it("names the first key of a file with comments under check, and writes nothing", () => {
  const root = jsonDir(TREE);
  expect(sortJson(root, ["comments.json", "conf/app.jsonc"], true)).toEqual({
    ok: true,
    found: [
      { file: "comments.json", key: "a" },
      { file: "conf/app.jsonc", key: "a" },
    ],
  });
  expect(readText(root, "conf/app.jsonc")).toBe(COMMENTED);
});

it("only reports under check, and a second run after a fix finds nothing and changes no byte", () => {
  const root = jsonDir(TREE);
  expect(sortJson(root, ["data.json"], true)).toEqual({ ok: true, found: [{ file: "data.json", key: "hooks" }] });
  expect(readText(root, "data.json")).toBe(UNSORTED);
  sortJson(root, ["data.json"], false);
  expect(sortJson(root, ["data.json"], false)).toEqual({ ok: true, found: [] });
  expect(readText(root, "data.json")).toBe(SORTED);
});

it("skips a listed file that is gone, and takes a config with no ignore patterns as ignoring nothing", () => {
  const root = jsonDir({ ".oxfmtrc.jsonc": "{}\n", "gen.json": UNSORTED });
  expect(sortJson(root, ["gone.json", "gen.json"], true)).toEqual({
    ok: true,
    found: [{ file: "gen.json", key: "hooks" }],
  });
});

it("says to run repo sync when the config is missing or not an oxfmt config", () => {
  const missing = ".oxfmtrc.jsonc is missing; run `bun repo sync` to write it";
  expect(sortJson(jsonDir({ "a.json": UNSORTED }), ["a.json"], false)).toEqual({ ok: false, error: missing });
  const invalid = ".oxfmtrc.jsonc is not a valid oxfmt config; run `bun repo sync` to write it again";
  expect(sortJson(jsonDir({ ".oxfmtrc.jsonc": "{ nope" }), ["a.json"], false)).toEqual({ ok: false, error: invalid });
  expect(sortJson(jsonDir({ ".oxfmtrc.jsonc": "[]" }), ["a.json"], false)).toEqual({ ok: false, error: invalid });
});
