import { describe, expect, it } from "vitest";

import {
  INCLUDES,
  STRICT_FLAGS,
  WEAK,
  consumerRepo,
  pkgRoot,
  srcConfig,
  useTsconfigKit,
  write,
} from "./__fixtures__/tsconfig-kit.ts";
import { checkTsconfigs } from "./check-tsconfig.ts";
import { tempDir } from "./sync/__fixtures__/temp-dirs.ts";

useTsconfigKit();

describe("checkTsconfigs", () => {
  it.each(STRICT_FLAGS)("refuses a tsconfig.src.json that turns %s off", (flag) => {
    const dir = consumerRepo();
    write(dir, "packages/api/tsconfig.json", {
      extends: "@workerstack/repo/tsconfig/bun",
      include: ["src"],
    });
    srcConfig(dir, "packages/api", { [flag]: false });
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([WEAK("packages/api/tsconfig.src.json", flag)]);
  });

  it("names every flag a tsconfig.src.json without the strict base resolves without", () => {
    const dir = consumerRepo();
    write(dir, "tsconfig.json", {
      extends: "@workerstack/repo/tsconfig/bun",
      include: ["src"],
    });
    write(dir, "tsconfig.src.json", {
      exclude: ["**/*.test.ts"],
      extends: "./tsconfig.json",
    });
    const missing = STRICT_FLAGS.filter((flag) => flag !== "noUncheckedIndexedAccess").join(", ");
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([WEAK("tsconfig.src.json", missing)]);
  });
});

describe("checkTsconfigs", () => {
  it("passes a tsconfig.json with its strict tsconfig.src.json", () => {
    const dir = consumerRepo();
    write(dir, "tsconfig.json", {
      extends: "@workerstack/repo/tsconfig/bun",
      include: ["src"],
    });
    srcConfig(dir, ".");
    write(dir, "src/a.ts", "export const f = () => 1\n");
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([]);
  });
});

describe("checkTsconfigs", () => {
  it("refuses a tsconfig.json and tsconfig.src.json that include a reject file, until both exclude it", () => {
    const dir = consumerRepo();
    write(dir, "tsconfig.json", {
      extends: "@workerstack/repo/tsconfig/bun",
      include: ["src"],
    });
    srcConfig(dir, ".");
    write(dir, "src/user.ts", "export const a = 1\n");
    write(dir, "src/user.reject.ts", "export const b: number = 'x'\n");
    write(dir, "src/view.reject.tsx", "export const c: number = 'x'\n");
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([
      INCLUDES("tsconfig.json", "src/user.reject.ts"),
      INCLUDES("tsconfig.json", "src/view.reject.tsx"),
      INCLUDES("tsconfig.src.json", "src/user.reject.ts"),
      INCLUDES("tsconfig.src.json", "src/view.reject.tsx"),
    ]);
    const exclude = ["**/*.reject.ts", "**/*.reject.tsx"];
    write(dir, "tsconfig.json", {
      exclude,
      extends: "@workerstack/repo/tsconfig/bun",
      include: ["src"],
    });
    write(dir, "tsconfig.src.json", {
      exclude: [...exclude, "**/*.test.ts"],
      extends: ["./tsconfig.json", "@workerstack/repo/tsconfig/strict"],
    });
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([]);
  });
});

describe("checkTsconfigs", () => {
  it("returns nothing outside a git repo", () => {
    const dir = tempDir("check-tsconfig-nogit-");
    write(dir, "tsconfig.json", { include: ["src"] });
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([]);
  });

  it("passes this repo's own tsconfigs", () => {
    expect(checkTsconfigs(pkgRoot, pkgRoot)).toStrictEqual([]);
  });
});
