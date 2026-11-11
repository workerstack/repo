import { describe, expect, it } from "vitest";

import { checkTsconfigs } from "./check-tsconfig.ts";
import {
  UNRUN,
  consumerRepo,
  pkgRoot,
  plainConfig,
  srcConfig,
  useTsconfigKit,
  write,
} from "./fixtures/tsconfig-kit.ts";

useTsconfigKit();

describe("checkTsconfigs extends and scripts of other shapes", () => {
  it("follows an extends written with or without .json and skips an extends of a package", () => {
    const dir = consumerRepo();
    plainConfig(dir, "tsconfig.base.json");
    plainConfig(dir, "tsconfig.other.json");
    write(dir, "tsconfig.json", {
      extends: ["@workerstack/repo/tsconfig/bun", "./tsconfig.base.json", "./tsconfig.other"],
      include: ["src"],
    });
    srcConfig(dir, ".");
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([]);
  });

  it("ignores a script block that is not an object and a script that is not a string", () => {
    const dir = consumerRepo();
    plainConfig(dir, "tsconfig.old.json");
    write(dir, "package.json", { name: "pkg", scripts: "tsc -p tsconfig.old.json" });
    write(dir, "packages/a/package.json", { name: "a", scripts: { typecheck: 1 } });
    write(dir, "packages/b/package.json", { name: "b", scripts: null });
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([UNRUN("tsconfig.old.json")]);
  });
});

describe("checkTsconfigs references", () => {
  it("passes configs a solution config references", () => {
    const dir = consumerRepo();
    write(dir, "tsconfig.json", {
      files: [],
      references: [{ path: "./a/tsconfig.app.json" }, { path: "./b" }],
    });
    plainConfig(dir, "a/tsconfig.app.json");
    plainConfig(dir, "b/tsconfig.json");
    srcConfig(dir, "b");
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([]);
  });

  it("ignores a reference that is not an object or has no string path", () => {
    const dir = consumerRepo();
    write(dir, "tsconfig.json", { files: [], references: ["./a", { path: 1 }, { path: "./a" }] });
    plainConfig(dir, "a/tsconfig.json");
    srcConfig(dir, "a");
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([]);
  });

  it("passes tsconfig.json with its tsconfig.src.json and a solution config alone", () => {
    const dir = consumerRepo();
    write(dir, "tsconfig.json", { files: [], references: [] });
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([]);
  });
});
