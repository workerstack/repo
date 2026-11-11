import { describe, expect, it } from "vitest";

import {
  UNRUN,
  consumerRepo,
  pkgRoot,
  plainConfig,
  script,
  srcConfig,
  useTsconfigKit,
  write,
} from "./__fixtures__/tsconfig-kit.ts";
import { checkTsconfigs } from "./check-tsconfig.ts";

useTsconfigKit();

describe("checkTsconfigs runs", () => {
  it("refuses a tsconfig no gate runs", () => {
    const dir = consumerRepo();
    plainConfig(dir, "tsconfig.old.json");
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([UNRUN("tsconfig.old.json")]);
  });

  it("names the config by its repo-relative posix path", () => {
    const dir = consumerRepo();
    plainConfig(dir, "packages/api/tsconfig.old.json");
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([UNRUN("packages/api/tsconfig.old.json")]);
  });

  it.each([
    "tsc -p tsconfig.old.json",
    "tsc -p ./tsconfig.old.json",
    "tsc --project=tsconfig.old.json",
    "tsc --noEmit --project tsconfig.old.json && echo ok",
  ])("passes a tsconfig a script runs with %s", (command) => {
    const dir = consumerRepo();
    plainConfig(dir, "tsconfig.old.json");
    script(dir, "package.json", command);
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([]);
  });
});

describe("checkTsconfigs script runs", () => {
  it("reads -p of a folder as that folder's tsconfig.json, not its other configs", () => {
    const dir = consumerRepo();
    plainConfig(dir, "tools/tsconfig.old.json");
    script(dir, "package.json", "tsc -p tools");
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([UNRUN("tools/tsconfig.old.json")]);
  });

  it("resolves a nested package's script from that package's own folder", () => {
    const dir = consumerRepo();
    plainConfig(dir, "packages/a/tsconfig.old.json");
    script(dir, "packages/a/package.json", "tsc -p tsconfig.old.json");
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([]);
  });

  it("does not resolve a script's path from another folder", () => {
    const dir = consumerRepo();
    plainConfig(dir, "packages/a/tsconfig.old.json");
    script(dir, "package.json", "tsc -p tsconfig.old.json");
    write(dir, "packages/a/package.json", { name: "a" });
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([UNRUN("packages/a/tsconfig.old.json")]);
  });
});

describe("checkTsconfigs extends and references", () => {
  it("passes a base that run configs extend, through a chain and an extends array", () => {
    const dir = consumerRepo();
    plainConfig(dir, "tsconfig.base.json");
    write(dir, "tsconfig.mid.json", { extends: "./tsconfig.base.json" });
    write(dir, "tsconfig.json", {
      extends: ["@workerstack/repo/tsconfig/bun", "./tsconfig.mid.json"],
      include: ["src"],
    });
    srcConfig(dir, ".");
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([]);
  });

  it("refuses a base that only an unrun config extends", () => {
    const dir = consumerRepo();
    plainConfig(dir, "tsconfig.base.json");
    write(dir, "tsconfig.old.json", { extends: "./tsconfig.base.json" });
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([UNRUN("tsconfig.base.json"), UNRUN("tsconfig.old.json")]);
  });
});
