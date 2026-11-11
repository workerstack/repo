import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  PROGRAM_TIMEOUT,
  UNKNOWN_TO_NUMBER,
  consumerRepo,
  diagnostics,
  hoistedRepo,
  pkgRoot,
  srcConfig,
  useTsconfigKit,
  write,
} from "./__fixtures__/tsconfig-kit.ts";
import { checkTsconfigs } from "./check-tsconfig.ts";

useTsconfigKit();

/** Writes `packages/api` on `base`, its `a.ts` an unknown-to-number line then `body`; returns its tsconfig path. */
function apiOn(dir: string, base: string, body = ""): string {
  const config = write(dir, "packages/api/tsconfig.json", {
    extends: `@workerstack/repo/tsconfig/${base}`,
    include: ["src"],
  });
  write(dir, "packages/api/src/a.ts", `const n: number = JSON.parse("1")\n${body}`);
  return config;
}

/** The diagnostics of `config`, after asserting none is a type library it cannot find (TS2688). */
function typeErrors(config: string) {
  const found = diagnostics(config);
  expect(found.filter((d) => d.code === 2688)).toStrictEqual([]);
  return found;
}

describe("checkTsconfigs", () => {
  it.each(["base", "bun", "worker", "web"])("passes a package that extends the %s base", (base) => {
    const dir = consumerRepo();
    apiOn(dir, base);
    srcConfig(dir, "packages/api");
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([]);
  });
});

describe("checkTsconfigs", () => {
  it.each([
    ["bun", "const v: string = Bun.version\n"],
    ["web", "const t: string = document.title\n"],
  ])(
    "the %s base types its runtime and keeps ts-reset",
    (base, runtimeLine) => {
      expect(typeErrors(apiOn(consumerRepo(), base, runtimeLine))).toStrictEqual([UNKNOWN_TO_NUMBER]);
    },
    PROGRAM_TIMEOUT,
  );
});

describe("checkTsconfigs", () => {
  it(
    "the worker base types the workers runtime and keeps ts-reset",
    () => {
      const { dir, installed } = hoistedRepo();
      write(dir, "node_modules/@cloudflare/workers-types/package.json", {
        name: "@cloudflare/workers-types",
        types: "index.d.ts",
      });
      write(dir, "node_modules/@cloudflare/workers-types/index.d.ts", "declare const WORKERS_STUB: string\n");
      const config = apiOn(dir, "worker", "const w: string = WORKERS_STUB\n");
      srcConfig(dir, "packages/api");
      expect(checkTsconfigs(dir, installed)).toStrictEqual([]);
      expect(typeErrors(config)).toStrictEqual([UNKNOWN_TO_NUMBER]);
    },
    PROGRAM_TIMEOUT,
  );
});

describe("checkTsconfigs", () => {
  it("passes a tsconfig that extends a local one that extends the base", () => {
    const dir = consumerRepo();
    write(dir, "tsconfig.base.json", {
      extends: "@workerstack/repo/tsconfig/base",
      include: ["packages/*/src"],
    });
    write(dir, "packages/a/tsconfig.json", {
      extends: "../../tsconfig.base.json",
      include: ["src"],
    });
    srcConfig(dir, "packages/a");
    write(dir, "packages/a/src/a.ts", "const a = 1\n");
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([]);
  });

  it("passes a solution-style root that checks no code", () => {
    const dir = consumerRepo();
    write(dir, "tsconfig.json", { files: [], references: [{ path: "./a" }] });
    write(dir, "a/tsconfig.json", {
      extends: "@workerstack/repo/tsconfig/bun",
      include: ["src"],
    });
    srcConfig(dir, "a");
    write(dir, "a/src/a.ts", "const a = 1\n");
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([]);
  });
});

describe("checkTsconfigs", () => {
  it("matches the package root through a symlinked install path", () => {
    const dir = consumerRepo();
    write(dir, "tsconfig.json", {
      extends: "@workerstack/repo/tsconfig/bun",
      include: ["src"],
    });
    srcConfig(dir, ".");
    write(dir, "src/a.ts", "const a = 1\n");
    expect(checkTsconfigs(dir, path.join(dir, "node_modules", "@workerstack", "repo"))).toStrictEqual([]);
  });
});
