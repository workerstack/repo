import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkEnvModules } from "./check-env-modules.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A temp git repo holding `files` (path → content); `track` adds them all to the index. */
function repoWith(files: Record<string, string>, track = true): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-env-module-"));
  dirs.push(dir);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  if (track) execFileSync("git", ["add", "-A"], { cwd: dir });
  return dir;
}

const PKG = "{}\n";
const ENV = "export {};\n";

const SIBLINGS = {
  "packages/a/package.json": PKG,
  "packages/a/src/env.ts": ENV,
  "packages/a/lib/env.ts": ENV,
};
const ROOT_PAIR = { "package.json": PKG, "env.ts": ENV, "src/env.ts": ENV };
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
      "packages/b/package.json": PKG,
      "packages/b/env.ts": ENV,
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
      "packages/a/package.json": PKG,
      "packages/a/env.ts": ENV,
      "packages/b/package.json": PKG,
      "packages/b/env.ts": ENV,
    });
    expect(checkEnvModules(dir)).toStrictEqual([]);
  });

  it("shows the root package as a dot", () => {
    expect(checkEnvModules(repoWith(ROOT_PAIR))).toStrictEqual([ROOT_LINE]);
  });

  it("skips a gitignored env.ts and counts an untracked one", () => {
    const files = { ".gitignore": "ignored/\n", "package.json": PKG, "env.ts": ENV, "ignored/env.ts": ENV };
    expect(checkEnvModules(repoWith(files))).toStrictEqual([]);
    expect(checkEnvModules(repoWith({ ...files, "src/env.ts": ENV }, false))).toStrictEqual([ROOT_LINE]);
  });

  it("is empty outside a git repo", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-env-module-"));
    dirs.push(dir);
    expect(checkEnvModules(dir)).toStrictEqual([]);
  });
});
