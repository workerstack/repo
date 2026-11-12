import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { BASE, CHECK_BEHIND, REPLIES, UPDATED } from "./__fixtures__/update-base.ts";
import { TIMEOUT, cleanup, world } from "./__fixtures__/update-world.ts";
import { main } from "./update.ts";

afterEach(cleanup);

const API = path.join("packages", "api", "package.json");

it("--check lists what is behind and where, skips what it cannot read, and exits 0", async () => {
  const w = world(BASE, REPLIES);
  expect(await main(["--check"], w.io())).toBe(0);
  expect(w.out).toStrictEqual(CHECK_BEHIND);
  expect(w.installs).toStrictEqual([]);
  expect(w.read("package.json").devDependencies).toStrictEqual({ typescript: "5.8.3" });
});

it("--check with names narrows the list", async () => {
  const w = world(BASE, REPLIES);
  expect(await main(["--check", "zod"], w.io())).toBe(0);
  expect(w.out).toStrictEqual([
    "1 behind of 1 checked:",
    "  zod  catalog              ^3.24.1 → ^4.1.12  major",
    "run `bun repo update` to write them, or `bun repo update <name>` for some",
  ]);
});

it("--check says every dependency is current when nothing is behind", async () => {
  const w = world({ "package.json": { dependencies: { zod: "^4.1.12" }, name: "r" } }, REPLIES);
  expect(await main(["--check"], w.io())).toBe(0);
  expect(w.out).toStrictEqual(["every dependency is on latest (1 checked)"]);
});

it("writes each bump once, formats the changed manifests, installs, and prints one line", async () => {
  const w = world(BASE, REPLIES);
  expect(await main([], w.io())).toBe(0);
  expect(w.out).toStrictEqual([UPDATED]);
  expect(w.read("package.json").workspaces).toStrictEqual({ catalog: { zod: "^4.1.12" }, packages: ["packages/*"] });
  expect(w.read("package.json").devDependencies).toStrictEqual({ typescript: "5.9.3" });
  expect(w.read("packages/api/package.json").devDependencies).toStrictEqual({ vitest: "^5.1.0" });
  expect(w.read("packages/api/package.json").dependencies).toStrictEqual({ "left-pad": "1.3.0", zod: "catalog:" });
  expect(w.formats.map((f) => f.files)).toStrictEqual([["package.json", API]]);
  expect(w.formats[0]?.seen[0]).toContain('"typescript": "5.9.3"');
  expect(w.installs).toStrictEqual([w.root]);
  expect(w.err).toStrictEqual([]);
});

it("a second run writes nothing and installs nothing", async () => {
  const w = world(BASE, REPLIES);
  await main([], w.io());
  w.out.length = 0;
  w.formats.length = 0;
  w.installs.length = 0;
  expect(await main([], w.io())).toBe(0);
  expect(w.out).toStrictEqual(["every dependency is on latest (4 checked)"]);
  expect(w.formats).toStrictEqual([]);
  expect(w.installs).toStrictEqual([]);
});

it("a name already on latest says so and writes nothing", async () => {
  const w = world(BASE, { ...REPLIES, zod: "3.24.1" });
  expect(await main(["zod"], w.io())).toBe(0);
  expect(w.out).toStrictEqual(["zod is on latest (^3.24.1)"]);
  expect(w.formats).toStrictEqual([]);
  expect(w.installs).toStrictEqual([]);
});

it("names narrow the write and report the ones already current", async () => {
  const w = world(BASE, REPLIES);
  expect(await main(["vitest", "left-pad"], w.io())).toBe(0);
  expect(w.out).toStrictEqual(["left-pad is on latest (1.3.0)", "updated 1: vitest ^5.0.1 → ^5.1.0 in packages/api"]);
  expect(w.read("package.json").devDependencies).toStrictEqual({ typescript: "5.8.3" });
});

it("a name nothing depends on exits 1", async () => {
  const w = world(BASE, REPLIES);
  expect(await main(["nope"], w.io())).toBe(1);
  expect(w.err).toStrictEqual(['repo update: nothing here depends on "nope"']);
  expect(w.out).toStrictEqual([]);
});

it.each([[["--check"]], [[]]])("a registry that does not answer exits 1 before any write (%j)", async (...argv) => {
  const w = world(BASE, { ...REPLIES, zod: TIMEOUT });
  expect(await main(argv.flat(), w.io())).toBe(1);
  expect(w.err).toStrictEqual([
    "repo update: registry.npmjs.org did not answer for zod (timeout); nothing was written",
  ]);
  expect(w.read("package.json").devDependencies).toStrictEqual({ typescript: "5.8.3" });
  expect(w.formats).toStrictEqual([]);
  expect(w.installs).toStrictEqual([]);
});

function failingInstall() {
  return { code: 1, output: "boom\nmore\n" };
}

function failingFormat() {
  return { code: 1, output: "bad\n" };
}

it("a failed install exits 1 with the way back and install's output", async () => {
  const w = world(BASE, REPLIES);
  expect(await main([], w.io({ install: failingInstall }))).toBe(1);
  expect(w.err).toStrictEqual([
    "repo update: bun install failed (exit 1); the manifests hold the new versions, " +
      "so run `bun install` once it is fixed:",
    "  boom",
    "  more",
  ]);
  expect(w.read("package.json").devDependencies).toStrictEqual({ typescript: "5.9.3" });
});

it("a failed format after a good install exits 1 and says the versions are installed", async () => {
  const w = world(BASE, REPLIES);
  expect(await main([], w.io({ format: failingFormat }))).toBe(1);
  expect(w.err).toStrictEqual([
    "repo update: could not format package.json, packages/api/package.json; " +
      "the new versions are installed so run `bun repo fmt` once it is fixed:",
    "  bad",
  ]);
  expect(w.installs).toStrictEqual([w.root]);
});

it("without an .oxfmtrc.jsonc nothing is formatted and the install still runs", async () => {
  const w = world(BASE, REPLIES);
  fs.rmSync(path.join(w.root, ".oxfmtrc.jsonc"));
  expect(await main([], w.io())).toBe(0);
  expect(w.formats).toStrictEqual([]);
  expect(w.installs).toStrictEqual([w.root]);
  expect(w.read("package.json").devDependencies).toStrictEqual({ typescript: "5.9.3" });
});

it("an unknown flag prints the usage and exits 2", async () => {
  const w = world(BASE, REPLIES);
  expect(await main(["--nope"], w.io())).toBe(2);
  expect(w.err).toStrictEqual(["repo update: usage: repo update [--check] [<name>|@scope/*…]"]);
});

const SYNC = "repo sync: wrote AGENTS.md; removed one old skill file";

it("prints the install's repo sync lines right after the updated line, and nothing else it printed", async () => {
  const w = world(BASE, REPLIES, { output: `bun install v1\n${SYNC}\nrepo sync: cut 1\n 3 packages installed\n` });
  expect(await main([], w.io())).toBe(0);
  expect(w.out).toStrictEqual([UPDATED, SYNC, "repo sync: cut 1"]);
  expect(w.err).toStrictEqual([]);
});

it("prints no repo sync line when the install fails", async () => {
  const w = world(BASE, REPLIES);

  function install() {
    return { code: 1, output: `${SYNC}\nboom\n` };
  }

  expect(await main([], w.io({ install }))).toBe(1);
  expect(w.out).toStrictEqual([UPDATED]);
  expect(w.err.slice(1)).toStrictEqual([`  ${SYNC}`, "  boom"]);
});
