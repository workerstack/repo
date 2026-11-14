import { execFileSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  NO_BASE,
  NO_SRC,
  SETS_FILES,
  UNRUN,
  consumerRepo,
  pkgRoot,
  srcConfig,
  useTsconfigKit,
  write,
} from "./__fixtures__/tsconfig-kit.ts";
import { checkTsconfigs } from "./check-tsconfig.ts";
import { removeTree } from "./remove-tree.ts";

useTsconfigKit();

describe("checkTsconfigs", () => {
  it("refuses a tsconfig that sets files", () => {
    const dir = consumerRepo();
    write(dir, "packages/api/tsconfig.json", {
      extends: "@workerstack/repo/tsconfig/worker",
      files: ["src/a.ts"],
    });
    write(dir, "packages/api/src/a.ts", "const a = 1\n");
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([
      SETS_FILES("packages/api/tsconfig.json"),
      NO_SRC("packages/api"),
    ]);
  });

  it("refuses an empty files list without references", () => {
    const dir = consumerRepo();
    write(dir, "tsconfig.json", {
      extends: "@workerstack/repo/tsconfig/bun",
      files: [],
      include: ["src"],
    });
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([SETS_FILES("tsconfig.json"), NO_SRC(".")]);
  });
});

describe("checkTsconfigs", () => {
  it("refuses a tsconfig whose own reset.d.ts is not the base's", () => {
    const dir = consumerRepo();
    write(dir, "tsconfig.json", { include: ["src"] });
    write(dir, "src/reset.d.ts", '/// <reference types="@total-typescript/ts-reset" />\n');
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([NO_BASE("tsconfig.json"), NO_SRC(".")]);
  });

  it("skips a tracked tsconfig deleted from the worktree", () => {
    const dir = consumerRepo();
    write(dir, "gone/tsconfig.json", { include: ["src"] });
    execFileSync("git", ["add", "gone/tsconfig.json"], { cwd: dir });
    removeTree(path.join(dir, "gone"));
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([]);
  });

  it("refuses a tsconfig that extends no base", () => {
    const dir = consumerRepo();
    write(dir, "packages/web/tsconfig.json", { include: ["src"] });
    write(dir, "packages/web/src/a.ts", "const a = 1\n");
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([NO_BASE("packages/web/tsconfig.json"), NO_SRC("packages/web")]);
  });
});

describe("checkTsconfigs", () => {
  it("reports a tsconfig it cannot read with its relative path", () => {
    const dir = consumerRepo();
    write(dir, "packages/old/tsconfig.json", '{ "include": ["src"]\n');
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual(["tsconfig: packages/old/tsconfig.json: '}' expected."]);
  });

  it("counts an untracked tsconfig and skips an ignored one", () => {
    const dir = consumerRepo();
    write(dir, ".gitignore", "node_modules\nignored/\n");
    write(dir, "ignored/tsconfig.json", { include: ["src"] });
    write(dir, "kept/tsconfig.json", { include: ["src"] });
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([NO_BASE("kept/tsconfig.json"), NO_SRC("kept")]);
  });

  it("counts tsconfig.json and tsconfig.<name>.json only", () => {
    const dir = consumerRepo();
    write(dir, "tsconfig.app.json", { include: ["src"] });
    write(dir, "tsconfig-old.json", { include: ["src"] });
    write(dir, "jsconfig.json", { include: ["src"] });
    write(dir, "tsconfig.json.bak", { include: ["src"] });
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([NO_BASE("tsconfig.app.json"), UNRUN("tsconfig.app.json")]);
  });
});

describe("checkTsconfigs", () => {
  it("refuses a tsconfig.json without a tsconfig.src.json beside it, at the root and in a package", () => {
    const dir = consumerRepo();
    write(dir, "tsconfig.json", {
      extends: "@workerstack/repo/tsconfig/bun",
      include: ["src"],
    });
    write(dir, "packages/api/tsconfig.json", {
      extends: "@workerstack/repo/tsconfig/bun",
      include: ["src"],
    });
    write(dir, "packages/web/tsconfig.json", {
      extends: "@workerstack/repo/tsconfig/web",
      include: ["src"],
    });
    srcConfig(dir, "packages/web");
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([NO_SRC("packages/api"), NO_SRC(".")]);
  });
});
