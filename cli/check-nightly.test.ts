import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkNightlyAt, nightlyProblems } from "./check-nightly.ts";
import type { Pack } from "./config.ts";
import { BASE_CONFIG } from "./fixtures/base-config.ts";
import { INSTALL_HINT } from "./mutate.constants.ts";
import type { PackageJson } from "./sync/workspace.ts";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const STRYKER: PackageJson = {
  devDependencies: { "@stryker-mutator/core": "10.1.1", "@stryker-mutator/vitest-runner": "10.1.1" },
};
const INSTALL_LINE = `the release pack runs mutation tests nightly; ${INSTALL_HINT}`;
const NO_FILE_LINE =
  "coverage.mutate (src/**/*.ts) matches no tracked file; set coverage.mutate in workerstack.config.ts";

const input = (manifest: PackageJson, tracked: string[], packs: Pack[] = ["release"]) => ({
  config: { packs, agents: { hosts: [], skills: [] }, ...BASE_CONFIG },
  workspace: { root: "/repo", manifest, packages: [] },
  tracked,
});

describe("nightlyProblems", () => {
  it("passes a root with both Stryker packages and a tracked file the globs match", () => {
    expect(nightlyProblems(input(STRYKER, ["src/a.ts"]))).toEqual([]);
  });

  it("names the install when a Stryker package is missing", () => {
    expect(nightlyProblems(input({}, ["src/a.ts"]))).toEqual([INSTALL_LINE]);
    const half = { dependencies: { "@stryker-mutator/core": "10.1.1" } };
    expect(nightlyProblems(input(half, ["src/a.ts"]))).toEqual([INSTALL_LINE]);
  });

  it("accepts Stryker as a dependency", () => {
    const deps = { dependencies: STRYKER.devDependencies ?? {} };
    expect(nightlyProblems(input(deps, ["src/a.ts"]))).toEqual([]);
  });

  it("names coverage.mutate when it matches no tracked file, tests and fixtures not counting", () => {
    expect(nightlyProblems(input(STRYKER, ["src/a.test.ts", "lib/b.ts"]))).toEqual([NO_FILE_LINE]);
  });

  it("reports both problems, install first", () => {
    expect(nightlyProblems(input({}, []))).toEqual([INSTALL_LINE, NO_FILE_LINE]);
  });

  it("checks nothing without the release pack", () => {
    expect(nightlyProblems(input({}, [], ["docs"]))).toEqual([]);
  });
});

describe("nightlyProblems in a Rust repo", () => {
  it("asks nothing of a Rust-only repo with no Stryker and no matching file", () => {
    expect(nightlyProblems(input({}, ["Cargo.toml", "crates/a/src/lib.rs"]))).toEqual([]);
  });

  it("asks a Rust repo with matching files for Stryker", () => {
    expect(nightlyProblems(input({}, ["Cargo.toml", "src/a.ts"]))).toEqual([INSTALL_LINE]);
  });

  it("asks a Rust repo with Stryker for files to mutate", () => {
    expect(nightlyProblems(input(STRYKER, ["Cargo.toml"]))).toEqual([NO_FILE_LINE]);
  });
});

/** A git repo holding `files`, committed or not per `commit`. */
function repo(files: Record<string, string>, commit = true): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "check-nightly-"));
  temps.push(root);
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  execFileSync("git", ["init", "-q"], { cwd: root });
  if (commit) execFileSync("git", ["add", "."], { cwd: root });
  return root;
}

const CONFIG = 'export default { packs: ["release"] };\n';
const MANIFEST = JSON.stringify({ name: "app", ...STRYKER });

describe("checkNightlyAt", () => {
  it("reads the config, the root manifest and the tracked files", async () => {
    const root = repo({ ["workerstack.config.ts"]: CONFIG, "package.json": "{}", "lib/a.ts": "" });
    expect(await checkNightlyAt(root)).toEqual([INSTALL_LINE, NO_FILE_LINE]);
  });

  it("passes a repo with Stryker and a tracked source", async () => {
    const root = repo({ "workerstack.config.ts": CONFIG, "package.json": MANIFEST, "src/a.ts": "" });
    expect(await checkNightlyAt(root)).toEqual([]);
  });

  it("does not count an untracked file", async () => {
    const root = repo({ "workerstack.config.ts": CONFIG, "package.json": MANIFEST }, true);
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(path.join(root, "src/a.ts"), "");
    expect(await checkNightlyAt(root)).toEqual([NO_FILE_LINE]);
  });

  it("leaves a bad config, an unreadable manifest and a missing git to the other checks", async () => {
    expect(await checkNightlyAt(repo({ "workerstack.config.ts": "export default 3;\n" }))).toEqual([]);
    expect(await checkNightlyAt(repo({ "workerstack.config.ts": CONFIG, "package.json": "[" }))).toEqual([]);
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), "check-nightly-bare-"));
    temps.push(bare);
    fs.writeFileSync(path.join(bare, "workerstack.config.ts"), CONFIG);
    fs.writeFileSync(path.join(bare, "package.json"), MANIFEST);
    expect(await checkNightlyAt(bare)).toEqual([]);
  });
});
