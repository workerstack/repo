import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { removePlanted, tempDir, write } from "../fixtures/planted-repo.ts";
import { spawnRunner } from "../scripts/ci-wait-run.ts";
import type { Runner } from "../scripts/ci-wait.ts";
import { OLD, removal, SHRUNK, TIMEOUT, withOld } from "./fixtures/api-cases.ts";
import { api, apiRepo, NAME, PREFIX } from "./fixtures/api-repo.ts";

afterEach(removePlanted);

const AGAINST = ["--against", "old.tgz"];
const realBun = spawnRunner("bun");
/** A bun that fails `bun add` of a spec starting with `prefix` (or any, when empty) and runs the rest. */
/** A bun whose `add` of a spec `pick` matches fails with `stderr`; every other call runs the real bun. */
const failing =
  (pick: (arg: string) => boolean, stderr: string): Runner =>
  (args, cwd) =>
    args[0] === "add" && args.some(pick) ? { code: 1, stdout: "", stderr } : realBun(args, cwd);

describe("repo release api usage", () => {
  it.each([["--nope"], ["--against"], ["--against", "a", "b"], ["old.tgz"]])("refuses %j with the usage", (...argv) => {
    expect(api(tempDir(), argv)).toMatchObject({
      code: 1,
      out: "",
      err: `${PREFIX}usage: repo release api [--against <tarball>]\n`,
    });
  });

  it("refuses a tarball that is not there", () => {
    const dir = apiRepo(SHRUNK, []);
    expect(api(dir, ["--against", "missing.tgz"])).toMatchObject({
      code: 1,
      err: `${PREFIX}no tarball at ${path.join(dir, "missing.tgz")}\n`,
    });
  });

  it("refuses a checkout with no package.json", () => {
    expect(api(tempDir(), [])).toMatchObject({ code: 1, err: `${PREFIX}package.json needs a name and a version\n` });
  });
});

describe("repo release api installs", () => {
  it("refuses a tarball bun cannot install", { timeout: TIMEOUT }, () => {
    const dir = apiRepo(SHRUNK, []);
    fs.writeFileSync(path.join(dir, "bad.tgz"), "not a tarball");
    const got = api(dir, ["--against", "bad.tgz"]);
    expect(got.code).toBe(1);
    expect(got.err).toMatch(new RegExp(`^${PREFIX}could not install bad.tgz: .+\n$`));
  });

  it("refuses a package that will not pack", { timeout: TIMEOUT }, () => {
    const dir = withOld(apiRepo(SHRUNK, []));
    write(dir, { "package.json": { name: NAME, version: "1.0.0", dependencies: { dep: "workspace:*" } } });
    const got = api(dir, AGAINST);
    expect(got.code).toBe(1);
    expect(got.err).toMatch(new RegExp(`^${PREFIX}bun pm pack failed: .+\n$`));
  });
});

describe("repo release api failed adds", () => {
  it("refuses when bun cannot add the checkout's tarball", { timeout: TIMEOUT }, () => {
    const got = api(withOld(apiRepo(SHRUNK, [])), AGAINST, { bun: failing((arg) => path.isAbsolute(arg), "boom\n") });
    expect(got.err).toBe(`${PREFIX}bun add failed: boom\n`);
  });

  it("refuses when bun cannot add the peers", { timeout: TIMEOUT }, () => {
    const dir = withOld(apiRepo(SHRUNK, []));
    const exports = { ".": { types: "./index.d.ts", default: "./index.js" } };
    const peers = { "peer-x": "^1" };
    const meta = { "peer-x": { optional: true } };
    write(dir, {
      "package.json": {
        name: NAME,
        version: "1.0.0",
        files: ["*.d.ts", "*.js"],
        exports,
        peerDependencies: peers,
        peerDependenciesMeta: meta,
      },
    });
    const got = api(dir, AGAINST, { bun: failing((arg) => arg.startsWith("peer-x"), "no peer\n") });
    expect(got.err).toBe(`${PREFIX}bun add failed: no peer\n`);
  });

  it("names a types file the checker cannot find", { timeout: TIMEOUT }, () => {
    const dir = withOld(apiRepo(SHRUNK, []), OLD, { ".": { types: "./missing.d.ts", default: "./other.js" } });
    expect(api(dir, AGAINST)).toMatchObject({ code: 1, err: `${PREFIX}cannot resolve "old" to a module\n` });
  });
});

describe("repo release api cleanup", () => {
  it("removes the project and pack dirs after a pass and after a refusal", { timeout: TIMEOUT }, () => {
    const passed = api(removal("refactor!: drop them"), AGAINST);
    const refused = api(removal("refactor: drop them"), AGAINST);
    expect([passed.code, refused.code]).toEqual([0, 1]);
    for (const got of [passed, refused]) {
      expect(got.made.length).toBeGreaterThanOrEqual(2);
      expect(got.made.filter((dir) => fs.existsSync(dir))).toEqual([]);
    }
  });
});
