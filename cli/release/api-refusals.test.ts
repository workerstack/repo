import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { removePlanted, tempDir, write } from "../fixtures/planted-repo.ts";
import { spawnRunner } from "../scripts/ci-wait-run.ts";
import type { Runner } from "../scripts/ci-wait.ts";
import { OLD, removal, SHRUNK, TIMEOUT, withOld } from "./fixtures/api-cases.ts";
import { api, apiRepo, NAME, PREFIX } from "./fixtures/api-repo.ts";

/** An `exports` condition map. Conditions resolve in order, so `types` stays before `default`. */
function conditions(types: string, runtime: string) {
  return {
    types,

    default: runtime,
  };
}

afterEach(removePlanted);

const AGAINST = ["--against", "old.tgz"];
const realBun = spawnRunner("bun");
/** A bun that fails `bun add` of a spec starting with `prefix` (or any, when empty) and runs the rest. */
/** A bun whose `add` of a spec `pick` matches fails with `stderr`; every other call runs the real bun. */
function failing(pick: (arg: string) => boolean, stderr: string): Runner {
  return (args, cwd) => (args[0] === "add" && args.some(pick) ? { code: 1, stderr, stdout: "" } : realBun(args, cwd));
}

describe("repo release api usage", () => {
  it.each([["--nope"], ["--against"], ["--against", "a", "b"], ["old.tgz"]])(
    "refuses %j with the usage",
    async (...argv) => {
      expect(await api(tempDir(), argv)).toMatchObject({
        code: 1,
        err: `${PREFIX}usage: repo release api [--against <tarball>]\n`,
        out: "",
      });
    },
  );

  it("refuses a tarball that is not there", async () => {
    const dir = apiRepo(SHRUNK, []);
    expect(await api(dir, ["--against", "missing.tgz"])).toMatchObject({
      code: 1,
      err: `${PREFIX}no tarball at ${path.join(dir, "missing.tgz")}\n`,
    });
  });

  it("refuses a checkout with no package.json", async () => {
    expect(await api(tempDir(), [])).toMatchObject({
      code: 1,
      err: `${PREFIX}package.json needs a name and a version\n`,
    });
  });
});

describe("repo release api installs", () => {
  it("refuses a tarball bun cannot install", { timeout: TIMEOUT }, async () => {
    const dir = apiRepo(SHRUNK, []);
    fs.writeFileSync(path.join(dir, "bad.tgz"), "not a tarball");
    const got = await api(dir, ["--against", "bad.tgz"]);
    expect(got.code).toBe(1);
    expect(got.err).toMatch(new RegExp(`^${PREFIX}could not install bad.tgz: .+\n$`));
  });

  it("refuses a package that will not pack", { timeout: TIMEOUT }, async () => {
    const dir = withOld(apiRepo(SHRUNK, []));
    write(dir, { "package.json": { dependencies: { dep: "workspace:*" }, name: NAME, version: "1.0.0" } });
    const got = await api(dir, AGAINST);
    expect(got.code).toBe(1);
    expect(got.err).toMatch(new RegExp(`^${PREFIX}bun pm pack failed: .+\n$`));
  });
});

describe("repo release api failed adds", () => {
  it("refuses when bun cannot add the checkout's tarball", { timeout: TIMEOUT }, async () => {
    const got = await api(withOld(apiRepo(SHRUNK, [])), AGAINST, {
      bun: failing((arg) => path.isAbsolute(arg), "boom\n"),
    });
    expect(got.err).toBe(`${PREFIX}bun add failed: boom\n`);
  });

  it("refuses when bun cannot add the peers", { timeout: TIMEOUT }, async () => {
    const dir = withOld(apiRepo(SHRUNK, []));
    const exports = { ".": conditions("./index.d.ts", "./index.js") };
    const peers = { "peer-x": "^1" };
    const meta = { "peer-x": { optional: true } };
    write(dir, {
      "package.json": {
        exports,
        files: ["*.d.ts", "*.js"],
        name: NAME,
        peerDependencies: peers,
        peerDependenciesMeta: meta,
        version: "1.0.0",
      },
    });
    const got = await api(dir, AGAINST, { bun: failing((arg) => arg.startsWith("peer-x"), "no peer\n") });
    expect(got.err).toBe(`${PREFIX}bun add failed: no peer\n`);
  });

  it("names a types file the checker cannot find", { timeout: TIMEOUT }, async () => {
    const dir = withOld(apiRepo(SHRUNK, []), OLD, { ".": conditions("./missing.d.ts", "./other.js") });
    expect(await api(dir, AGAINST)).toMatchObject({ code: 1, err: `${PREFIX}cannot resolve "old" to a module\n` });
  });
});

describe("repo release api cleanup", () => {
  it("removes the project and pack dirs after a pass and after a refusal", { timeout: TIMEOUT }, async () => {
    const passed = await api(removal("refactor!: drop them"), AGAINST);
    const refused = await api(removal("refactor: drop them"), AGAINST);
    expect([passed.code, refused.code]).toStrictEqual([0, 1]);
    for (const got of [passed, refused]) {
      expect(got.made.length).toBeGreaterThanOrEqual(2);
      expect(got.made.filter((dir) => fs.existsSync(dir))).toStrictEqual([]);
    }
  });
});
