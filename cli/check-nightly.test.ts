import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { BASE_CONFIG } from "./__fixtures__/base-config.ts";
import { useTempTree } from "./__fixtures__/temp-tree.ts";
import { AGENT_DEFAULTS } from "./agent-defaults.constants.ts";
import { checkNightlyAt, nightlyProblems } from "./check-nightly.ts";
import type { Pack } from "./config.ts";
import { INSTALL_HINT } from "./mutate.constants.ts";
import type { PackageJson } from "./sync/workspace.ts";

const plant = useTempTree("check-nightly-");

const STRYKER: PackageJson = {
  devDependencies: { "@stryker-mutator/core": "10.1.1", "@stryker-mutator/vitest-runner": "10.1.1" },
};

const INSTALL_LINE = `the release pack runs mutation tests nightly; ${INSTALL_HINT}`;

const NO_FILE_LINE = "coverage.mutate (src/**/*.ts) matches no tracked file; set coverage.mutate in repo.config.ts";

function input(manifest: PackageJson, tracked: string[], packs: Pack[] = ["release"]) {
  return {
    config: { agents: { ...AGENT_DEFAULTS, hosts: [], skills: [] }, packs, ...BASE_CONFIG },
    tracked,
    workspace: { manifest, packages: [], root: "/repo" },
  };
}

describe("nightlyProblems", () => {
  it("passes a root with both Stryker packages and a tracked file the globs match", () => {
    expect(nightlyProblems(input(STRYKER, ["src/a.ts"]))).toStrictEqual([]);
  });

  it("names the install when a Stryker package is missing", () => {
    expect(nightlyProblems(input({}, ["src/a.ts"]))).toStrictEqual([INSTALL_LINE]);
    const half = { dependencies: { "@stryker-mutator/core": "10.1.1" } };
    expect(nightlyProblems(input(half, ["src/a.ts"]))).toStrictEqual([INSTALL_LINE]);
  });

  it("accepts Stryker as a dependency", () => {
    const deps = { dependencies: STRYKER.devDependencies ?? {} };
    expect(nightlyProblems(input(deps, ["src/a.ts"]))).toStrictEqual([]);
  });

  it("names coverage.mutate when it matches no tracked file, tests and fixtures not counting", () => {
    expect(nightlyProblems(input(STRYKER, ["src/a.test.ts", "lib/b.ts"]))).toStrictEqual([NO_FILE_LINE]);
  });

  it("reports both problems, install first", () => {
    expect(nightlyProblems(input({}, []))).toStrictEqual([INSTALL_LINE, NO_FILE_LINE]);
  });

  it("checks nothing without the release pack", () => {
    expect(nightlyProblems(input({}, [], ["docs"]))).toStrictEqual([]);
  });
});

describe("nightlyProblems in a Rust repo", () => {
  it("asks nothing of a Rust-only repo with no Stryker and no matching file", () => {
    expect(nightlyProblems(input({}, ["Cargo.toml", "crates/a/src/lib.rs"]))).toStrictEqual([]);
  });

  it("asks a Rust repo with matching files for Stryker", () => {
    expect(nightlyProblems(input({}, ["Cargo.toml", "src/a.ts"]))).toStrictEqual([INSTALL_LINE]);
  });

  it("asks a Rust repo with Stryker for files to mutate", () => {
    expect(nightlyProblems(input(STRYKER, ["Cargo.toml"]))).toStrictEqual([NO_FILE_LINE]);
  });
});

/** A git repo holding `files`, all added to the index. */
function repo(files: Record<string, string>): string {
  const root = plant(files);
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });

  return root;
}

const CONFIG = 'export default { packs: ["release"] };\n';
const MANIFEST = JSON.stringify({ name: "app", ...STRYKER });

describe("checkNightlyAt", () => {
  it("reads the config, the root manifest and the tracked files", async () => {
    const root = repo({ "lib/a.ts": "", "package.json": "{}", ["repo.config.ts"]: CONFIG });
    expect(await checkNightlyAt(root)).toStrictEqual([INSTALL_LINE, NO_FILE_LINE]);
  });

  it("passes a repo with Stryker and a tracked source", async () => {
    const root = repo({ "package.json": MANIFEST, "repo.config.ts": CONFIG, "src/a.ts": "" });
    expect(await checkNightlyAt(root)).toStrictEqual([]);
  });

  it("does not count an untracked file", async () => {
    const root = repo({ "package.json": MANIFEST, "repo.config.ts": CONFIG });
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(path.join(root, "src/a.ts"), "");
    expect(await checkNightlyAt(root)).toStrictEqual([NO_FILE_LINE]);
  });

  it("leaves a bad config, an unreadable manifest and a missing git to the other checks", async () => {
    expect(await checkNightlyAt(repo({ "repo.config.ts": "export default 3;\n" }))).toStrictEqual([]);
    expect(await checkNightlyAt(repo({ "package.json": "[", "repo.config.ts": CONFIG }))).toStrictEqual([]);
    const bare = plant({ "package.json": MANIFEST, "repo.config.ts": CONFIG });
    expect(await checkNightlyAt(bare)).toStrictEqual([]);
  });
});
