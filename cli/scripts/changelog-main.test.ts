import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it, vi } from "vitest";

import { useCapturedRun } from "../__fixtures__/captured-run.ts";
import { FILLED, OLDER, plantRepo, stagedNames, type RepoOptions } from "./__fixtures__/changelog-kit.ts";
import { git } from "./__fixtures__/lessons-kit.ts";
import { USAGE } from "./changelog.constants.ts";
import { main } from "./changelog.ts";
import type { Roots } from "./workspace-root.ts";

const captured = useCapturedRun();

/** The roots of a temp checkout. */
function rootsOf(root: string): Roots {
  return { checkout: root, cwd: root, root };
}

/** A temp git repo of `files` over a public root package and a public `packages/pub`. */
function setup(files: Record<string, string> = {}, options: RepoOptions = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "changelog-main-")));

  plantRepo(root, files, options);
  captured.temps.push(root);

  return { root, roots: rootsOf(root) };
}

function run(roots: Roots, ...argv: string[]): number {
  return main(argv, () => roots);
}

it("prints the root changelog in a clean tree with no owner lookup", () => {
  const { roots } = setup();

  expect(run(roots)).toBe(0);
  expect(captured.out).toStrictEqual(["## [Unreleased]\n\n### Added\n\n- a\n"]);
});

it("prints the Unreleased section only, or that it is empty", () => {
  const { roots } = setup();

  expect(run(roots, "--dir", ".")).toBe(0);
  expect(run(roots, "--dir", "packages/pub")).toBe(0);
  expect(captured.out).toStrictEqual([
    "## [Unreleased]\n\n### Added\n\n- a\n",
    "[Unreleased] in packages/pub/CHANGELOG.md is empty\n",
  ]);
});

it("reads a CRLF changelog and writes the entry with CRLF", () => {
  const crlf = FILLED.replaceAll("\n", "\r\n");
  const { root, roots } = setup({ "CHANGELOG.md": crlf });

  expect(run(roots, "--dir", ".")).toBe(0);
  expect(run(roots, "add", "Added", "b", "--dir", ".")).toBe(0);
  expect(captured.out).toStrictEqual(["## [Unreleased]\n\n### Added\n\n- a\n", "CHANGELOG.md:8  - b\n"]);
  expect(fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8")).toBe(crlf.replace("- a\r\n", "- a\r\n- b\r\n"));
});

it("adds for the staged owner and stages the file", () => {
  const { root, roots } = setup();

  fs.writeFileSync(path.join(root, "packages/pub/x.ts"), "changed\n");
  git(root, "add", "packages/pub/x.ts");
  expect(run(roots, "add", "Added", "one", "thing")).toBe(0);
  expect(captured.out).toStrictEqual([
    "packages/pub/CHANGELOG.md:7  - one thing\n",
    "staged packages/pub/CHANGELOG.md\n",
  ]);
  expect(stagedNames(root)).toStrictEqual(["packages/pub/CHANGELOG.md", "packages/pub/x.ts"]);
});

it("adds for the changed owner of a repo with no commit and stages nothing", () => {
  const { root, roots } = setup({}, { commit: false, rootPublic: false });

  fs.rmSync(path.join(root, "x.ts"));
  expect(run(roots, "add", "Fixed", "- c")).toBe(0);
  expect(captured.out).toStrictEqual(["packages/pub/CHANGELOG.md:7  - c\n"]);
  expect(stagedNames(root)).toStrictEqual([]);
});

it("takes a renamed file by its new path", () => {
  const { root, roots } = setup({ "priv/package.json": JSON.stringify({ private: true }) }, { rootPublic: false });

  git(root, "mv", "packages/pub/x.ts", "priv/x.ts");
  expect(run(roots, "add", "Added", "b")).toBe(1);
  expect(captured.err).toStrictEqual(["no staged or changed file is in a public package; pass --dir <package dir>\n"]);
});

it("refuses when several public packages are staged or changed", () => {
  const { root, roots } = setup();

  fs.writeFileSync(path.join(root, "x.ts"), "changed\n");
  fs.writeFileSync(path.join(root, "packages/pub/x.ts"), "changed\n");
  expect(run(roots, "add", "Added", "b")).toBe(1);
  git(root, "add", "-A");
  expect(run(roots, "add", "Added", "b")).toBe(1);
  expect(captured.err).toStrictEqual([
    "the changed files span ., packages/pub; pass --dir <package dir>\n",
    "the staged files span ., packages/pub; pass --dir <package dir>\n",
  ]);
});

it("refuses a --dir with no file or no Unreleased", () => {
  const { roots } = setup({ "lib/CHANGELOG.md": `# Changelog\n\n${OLDER}` });

  expect(run(roots, "--dir", "nope")).toBe(1);
  expect(run(roots, "add", "Added", "b", "--dir", "lib")).toBe(1);
  expect(run(roots, "--dir", "lib")).toBe(1);
  expect(captured.err).toStrictEqual([
    "nope/CHANGELOG.md is missing; add one in the Keep a Changelog format\n",
    "lib/CHANGELOG.md has no ## [Unreleased] section; add it above the newest version\n",
    "lib/CHANGELOG.md has no ## [Unreleased] section; add it above the newest version\n",
  ]);
});

it.each([
  [["frob"], USAGE],
  [["add"], USAGE],
  [["add", "Added"], USAGE],
  [["--dir"], USAGE],
  [["--dir", "a", "--dir", "b"], USAGE],
  [["--dir", "../x"], "--dir must be inside the checkout"],
  [["add", "Fixes", "x"], "section must be Added, Changed, Deprecated, Removed, Fixed or Security"],
  [["add", "Added", "a\nb"], "the entry is one line"],
])("exits 2 for %j", (argv, message) => {
  const { roots } = setup();

  expect(run(roots, ...argv)).toBe(2);
  expect(captured.err).toStrictEqual([`${message}\n`]);
  expect(captured.out).toStrictEqual([]);
});

it("exits 1 with the message of an error from the roots lookup", () => {
  expect(
    main(["--dir", "."], () => {
      throw new Error("not a checkout");
    }),
  ).toBe(1);
  expect(captured.err).toStrictEqual(["not a checkout\n"]);
});

it("finds the checkout from the working directory by default", () => {
  const { root } = setup();

  vi.stubEnv("CLAUDE_PROJECT_DIR", "");
  vi.stubEnv("GROK_WORKSPACE_ROOT", "");
  process.chdir(root);
  expect(main(["--dir", "packages/pub"])).toBe(0);
  expect(captured.out).toStrictEqual(["[Unreleased] in packages/pub/CHANGELOG.md is empty\n"]);
});
