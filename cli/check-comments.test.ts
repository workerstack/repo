import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { checkComments, commentProblems, sourceFiles } from "./check-comments.ts";
import { captureBun } from "./scripts/lint.ts";

const temps: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const LINT = (word: string) =>
  `"${word}" switches a lint rule off; fix the code, or add a lint.skip entry with a reason`;
const IGNORE = '"@ts-ignore" hides a type error; fix the type, or write @ts-expect-error with a reason';
const NOCHECK = '"@ts-nocheck" turns type checking off for the file; fix the types instead';
const EXPECT = '"@ts-expect-error" needs a reason: // @ts-expect-error <why this line must not compile>';

/** A temp dir holding `files`. */
function plant(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-comments-"));
  temps.push(root);
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}

const git = (root: string, ...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });

/** The problems of one planted file. */
const problemsOf = (text: string, rel = "a.ts") => commentProblems(plant({ [rel]: text }), [rel]);

it("names each refused comment with its file and line, in the order of the files given", () => {
  const root = plant({
    "src/a.ts":
      "export const a = 1;\n\n// oxlint-disable-next-line repo/no-module-state\nlet b = 2;\n\nb++;\n// @ts-ignore\n",
    "src/b.ts": "// @ts-nocheck\n".concat("\n".repeat(7), "// @ts-expect-error\nexport const c: number = 'c';\n"),
  });
  expect(commentProblems(root, ["src/a.ts", "src/b.ts"])).toEqual([
    `src/a.ts:3: ${LINT("oxlint-disable-next-line")}`,
    `src/a.ts:7: ${IGNORE}`,
    `src/b.ts:1: ${NOCHECK}`,
    `src/b.ts:9: ${EXPECT}`,
  ]);
});

it.each([
  ["// eslint-disable\n", 1, "eslint-disable"],
  ["// oxlint-disable no-debugger -- legacy\n", 1, "oxlint-disable"],
  ["debugger; // eslint-disable-line\n", 1, "eslint-disable-line"],
  ["//eslint-disable-next-line\n", 1, "eslint-disable-next-line"],
  ["/* eslint-disable no-debugger */\n", 1, "eslint-disable"],
  ["/*eslint-disable*/\n", 1, "eslint-disable"],
  ["/*\n   oxlint-disable */\n", 2, "oxlint-disable"],
  ["const s = 1;\n\n/* eslint-disable-next-line */\n", 3, "eslint-disable-next-line"],
])("refuses the lint directive in %j", (text, line, word) => {
  expect(problemsOf(text)).toEqual([`a.ts:${line}: ${LINT(word)}`]);
});

it.each([
  ["/// @ts-ignore\n", 1, IGNORE],
  ["/* @ts-ignore */ const a = 1;\n", 1, IGNORE],
  ["// @ts-ignored, as TypeScript reads any word that starts so\n", 1, IGNORE],
  ["/**\n * Some prose first.\n * @ts-ignore */\n", 3, IGNORE],
  ["#!/usr/bin/env bun\n// @TS-NOCHECK\n", 2, NOCHECK],
  ["// leading\n/* also leading */ //@ts-nocheck: why\n", 2, NOCHECK],
  ["// @ts-expect-error parsed above\n", 1, EXPECT],
  ["/* @ts-expect-error */\n", 1, EXPECT],
  ["/**\n * @ts-expect-error */\n", 2, EXPECT],
])("refuses the TypeScript directive in %j", (text, line, message) => {
  expect(problemsOf(text)).toEqual([`a.ts:${line}: ${message}`]);
});

it.each([
  '// @ts-expect-error "lint" is not a pack\n',
  "/* @ts-expect-error the schema allows no pack named lint */\n",
  'export const s = "// oxlint-disable";\n',
  "/** never write eslint-disable here */\n",
  "/** eslint-disable */\n",
  "// eslint-disabled\n",
  "// eslint-disable-next-line-- no space, so oxlint reads no directive\n",
  "// ESLINT-DISABLE\n",
  "// see @ts-ignore in the handbook\n",
  "/** @ts-ignore\n * on a line before the last, which TypeScript does not read\n */\n",
  'import "./b.ts";\n// @ts-nocheck\n',
  "/* @ts-nocheck */\n",
  "// @ts-nocheckers\n",
])("passes %j", (text) => {
  expect(problemsOf(text)).toEqual([]);
});

it("reads the multi-line block form as real tsc does: honored only on the block's last line", () => {
  const root = plant({
    "last.ts": "/**\n * Some prose first.\n * @ts-ignore */\nexport const a: number = 'a';\n",
    "first.ts": "/** @ts-ignore\n * more prose\n */\nexport const b: number = 'b';\n",
  });
  const tsc = path.join(path.dirname(Bun.resolveSync("typescript/package.json", import.meta.dirname)), "bin/tsc");
  const run = (rel: string) => captureBun([tsc, "--noEmit", "--strict", rel], root).code;
  expect({ last: run("last.ts"), first: run("first.ts") }).toEqual({ last: 0, first: 2 });
  expect(commentProblems(root, ["last.ts", "first.ts"])).toEqual([`last.ts:3: ${IGNORE}`]);
}, 30_000);

it("scans the comments a file with a parse error still returns", () => {
  expect(problemsOf("// @ts-ignore\nconst = ;\n")).toEqual([`a.ts:1: ${IGNORE}`]);
});

it("skips a listed file that cannot be read, and files that are not source", () => {
  const root = plant({ "a.md": "// @ts-ignore\n", "fixtures/a.ts": "// @ts-ignore\n" });
  expect(commentProblems(root, ["gone.ts", "a.md", "fixtures/a.ts"])).toEqual([]);
});

/** A git repo with a committed file, an untracked one, and files `sourceFiles` leaves out. */
function repo(): string {
  const root = plant({
    ".gitignore": "dist\n",
    "src/a.ts": "",
    "dist/out.js": "",
    "cli/fixtures/f.ts": "",
    "README.md": "",
    "styles.css": "",
  });
  git(root, "init", "-q");
  git(root, "add", "-A");
  git(root, "-c", "user.email=a@b", "-c", "user.name=a", "commit", "-q", "-m", "init");
  for (const ext of ["tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"]) fs.writeFileSync(path.join(root, `b.${ext}`), "");
  return root;
}

const LISTED = ["b.cjs", "b.cts", "b.js", "b.jsx", "b.mjs", "b.mts", "b.tsx", "src/a.ts"];

it("lists tracked and untracked source files, leaving out ignored, fixtures and other extensions", () => {
  expect(sourceFiles(repo())).toEqual({ ok: true, files: LISTED });
});

it("lists the same files under a hook's GIT_INDEX_FILE naming another index", () => {
  const root = repo();
  vi.stubEnv("GIT_INDEX_FILE", path.join(plant({}), "index"));
  expect(sourceFiles(root)).toEqual({ ok: true, files: LISTED });
});

it("says why when git cannot list the files", () => {
  const listed = sourceFiles(plant({}));
  expect(listed.ok).toBe(false);
  expect(listed.ok ? [] : listed.errors).toEqual([
    expect.stringMatching(/^git ls-files failed: .*not a git repository/),
  ]);
});

it("checkComments scans the listed files, or reports why it could not list them", () => {
  const root = repo();
  fs.writeFileSync(path.join(root, "src/a.ts"), "// @ts-ignore\n");
  expect(checkComments(root)).toEqual([`src/a.ts:1: ${IGNORE}`]);
  expect(checkComments(plant({}))).toEqual([expect.stringMatching(/^git ls-files failed: /)]);
});
