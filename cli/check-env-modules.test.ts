import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { checkEnvModules } from "./check-env-modules.ts";
import { useTempTree } from "./fixtures/temp-tree.ts";

const plant = useTempTree("check-env-module-");

/** A temp git repo holding `files` (path → content), none of them added to the index. */
function untrackedRepo(files: Record<string, string>): string {
  const dir = plant(files);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}

/** A temp git repo holding `files` (path → content), all added to the index. */
function repoWith(files: Record<string, string>): string {
  const dir = untrackedRepo(files);
  execFileSync("git", ["add", "-A"], { cwd: dir });
  return dir;
}

const PKG = "{}\n";
const ENV = "export {};\n";

const SIBLINGS = {
  "packages/a/lib/env.ts": ENV,
  "packages/a/package.json": PKG,
  "packages/a/src/env.ts": ENV,
};
const ROOT_PAIR = { "env.ts": ENV, "package.json": PKG, "src/env.ts": ENV };
const ROOT_LINE = "env: env.ts and src/env.ts are both env.ts in .; keep one";

describe("checkEnvModules", () => {
  it("fails two env.ts under one package.json, naming both sorted", () => {
    const dir = repoWith(SIBLINGS);
    expect(checkEnvModules(dir)).toStrictEqual([
      "env: packages/a/lib/env.ts and packages/a/src/env.ts are both env.ts in packages/a; keep one",
    ]);
  });

  it("lists the packages in sorted order", () => {
    const dir = repoWith({
      "packages/b/env.ts": ENV,
      "packages/b/package.json": PKG,
      "packages/b/src/env.ts": ENV,
      ...SIBLINGS,
    });
    expect(checkEnvModules(dir).map((line) => line.split(" in ")[1])).toStrictEqual([
      "packages/a; keep one",
      "packages/b; keep one",
    ]);
  });
});

describe("checkEnvModules, other layouts", () => {
  it("passes one env.ts per package", () => {
    const dir = repoWith({
      "packages/a/env.ts": ENV,
      "packages/a/package.json": PKG,
      "packages/b/env.ts": ENV,
      "packages/b/package.json": PKG,
    });
    expect(checkEnvModules(dir)).toStrictEqual([]);
  });

  it("shows the root package as a dot", () => {
    expect(checkEnvModules(repoWith(ROOT_PAIR))).toStrictEqual([ROOT_LINE]);
  });

  it("skips a gitignored env.ts and counts an untracked one", () => {
    const files = { ".gitignore": "ignored/\n", "env.ts": ENV, "ignored/env.ts": ENV, "package.json": PKG };
    expect(checkEnvModules(repoWith(files))).toStrictEqual([]);
    expect(checkEnvModules(untrackedRepo({ ...files, "src/env.ts": ENV }))).toStrictEqual([ROOT_LINE]);
  });

  it("is empty outside a git repo", () => {
    expect(checkEnvModules(plant({}))).toStrictEqual([]);
  });
});
