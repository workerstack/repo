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

/** The lines a check reports for a repo whose `tsconfig.old.json` is run by nothing but the package.json `command`. */
function oldConfigLines(command: string, rel = "tsconfig.old.json"): Promise<string[]> {
  const dir = consumerRepo();
  plainConfig(dir, rel);
  script(dir, "package.json", command);

  return checkTsconfigs(dir, pkgRoot);
}

describe("checkTsconfigs runs", () => {
  it("refuses a tsconfig no gate runs", async () => {
    const dir = consumerRepo();
    plainConfig(dir, "tsconfig.old.json");
    expect(await checkTsconfigs(dir, pkgRoot)).toStrictEqual([UNRUN("tsconfig.old.json")]);
  });

  it("names the config by its repo-relative posix path", async () => {
    const dir = consumerRepo();
    plainConfig(dir, "packages/api/tsconfig.old.json");
    expect(await checkTsconfigs(dir, pkgRoot)).toStrictEqual([UNRUN("packages/api/tsconfig.old.json")]);
  });

  it.each([
    "tsc -p tsconfig.old.json",
    "tsc -p ./tsconfig.old.json",
    "tsc --project=tsconfig.old.json",
    "tsc --noEmit --project tsconfig.old.json && echo ok",
  ])("passes a tsconfig a script runs with %s", async (command) => {
    expect(await oldConfigLines(command)).toStrictEqual([]);
  });
});

describe("checkTsconfigs script runs", () => {
  it("reads -p of a folder as that folder's tsconfig.json, not its other configs", async () => {
    const dir = consumerRepo();
    plainConfig(dir, "tools/tsconfig.old.json");
    script(dir, "package.json", "tsc -p tools");
    expect(await checkTsconfigs(dir, pkgRoot)).toStrictEqual([UNRUN("tools/tsconfig.old.json")]);
  });

  it("resolves a nested package's script from that package's own folder", async () => {
    const dir = consumerRepo();
    plainConfig(dir, "packages/a/tsconfig.old.json");
    script(dir, "packages/a/package.json", "tsc -p tsconfig.old.json");
    expect(await checkTsconfigs(dir, pkgRoot)).toStrictEqual([]);
  });

  it("does not resolve a script's path from another folder", async () => {
    const dir = consumerRepo();
    plainConfig(dir, "packages/a/tsconfig.old.json");
    script(dir, "package.json", "tsc -p tsconfig.old.json");
    write(dir, "packages/a/package.json", { name: "a" });
    expect(await checkTsconfigs(dir, pkgRoot)).toStrictEqual([UNRUN("packages/a/tsconfig.old.json")]);
  });
});

describe("checkTsconfigs tsc -b runs", () => {
  it.each([
    "tsc -b tsconfig.old.json",
    "tsc --build ./tsconfig.old.json --force",
    "tsc -b tsconfig.a.json tsconfig.old.json --watch",
    "tsc -b --verbose tsconfig.old.json",
    "tsc -b a.json --force tsconfig.old.json && echo ok",
  ])("passes a tsconfig a script builds with %s", async (command) => {
    expect(await oldConfigLines(command)).toStrictEqual([]);
  });

  it("reads tsc -b of a folder as that folder's tsconfig.json", async () => {
    const dir = consumerRepo();
    plainConfig(dir, "tools/tsconfig.json");
    srcConfig(dir, "tools");
    plainConfig(dir, "tools/tsconfig.old.json");
    script(dir, "package.json", "tsc -b tools");
    expect(await checkTsconfigs(dir, pkgRoot)).toStrictEqual([UNRUN("tools/tsconfig.old.json")]);
  });

  it("passes a config a tsc -b solution references", async () => {
    const dir = consumerRepo();
    write(dir, "tsconfig.build.json", { files: [], references: [{ path: "./tsconfig.api.json" }] });
    plainConfig(dir, "tsconfig.api.json");
    script(dir, "package.json", "tsc -b tsconfig.build.json --watch");
    expect(await checkTsconfigs(dir, pkgRoot)).toStrictEqual([]);
  });
});

describe("checkTsconfigs other -b flags", () => {
  it.each([
    ["git checkout -b tools", "tools/tsconfig.old.json"],
    ["tsc --noEmit -b tsconfig.old.json", "tsconfig.old.json"],
    ["tsc -b tsconfig.a.json; echo tsconfig.old.json", "tsconfig.old.json"],
  ])("does not read a project from %s", async (command, rel) => {
    expect(await oldConfigLines(command, rel)).toStrictEqual([UNRUN(rel)]);
  });
});

describe("checkTsconfigs extends and references", () => {
  it("passes a base that run configs extend, through a chain and an extends array", async () => {
    const dir = consumerRepo();
    plainConfig(dir, "tsconfig.base.json");
    write(dir, "tsconfig.mid.json", { extends: "./tsconfig.base.json" });
    write(dir, "tsconfig.json", {
      extends: ["@workerstack/repo/tsconfig/bun", "./tsconfig.mid.json"],
      include: ["src"],
    });
    srcConfig(dir, ".");
    expect(await checkTsconfigs(dir, pkgRoot)).toStrictEqual([]);
  });

  it("refuses a base that only an unrun config extends", async () => {
    const dir = consumerRepo();
    plainConfig(dir, "tsconfig.base.json");
    write(dir, "tsconfig.old.json", { extends: "./tsconfig.base.json" });
    expect(await checkTsconfigs(dir, pkgRoot)).toStrictEqual([UNRUN("tsconfig.base.json"), UNRUN("tsconfig.old.json")]);
  });
});
