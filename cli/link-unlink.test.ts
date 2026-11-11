import fs from "node:fs";

import { expect, it } from "vitest";

import { linkedPair } from "./__fixtures__/link-two.ts";
import { NAME, NONE, mod, npmCopy, scene, stateFile, stateOf } from "./__fixtures__/link-world.ts";
import { main, unlinkMain } from "./link.ts";

it("puts npm back and says which version", async () => {
  const w = scene();
  await main([NAME], w.io());
  w.out.length = 0;
  function install(root: string) {
    w.installs.push(root);
    npmCopy(root, NAME, "0.3.2");
    return { code: 0, output: "" };
  }
  expect(await unlinkMain([NAME], w.io({ install }))).toBe(0);
  expect(w.out).toStrictEqual([`unlinked ${NAME}: back on npm 0.3.2`]);
  expect(w.installs).toStrictEqual([w.main]);
  expect(stateOf(w.main).links).toStrictEqual({});
  await unlinkMain(["--all"], w.io({ install }));
  expect(w.out.at(-1)).toBe(NONE);
});

it("drops the state entry before it calls install", async () => {
  const w = scene();
  await main([NAME], w.io());
  const seen: unknown[] = [];
  function install(root: string) {
    seen.push(stateOf(root).links, fs.existsSync(mod(root, NAME)));
    return { code: 0, output: "" };
  }
  await unlinkMain([NAME], w.io({ install }));
  expect(seen).toStrictEqual([{}, false]);
});

it("falls back to the recorded npm version while install has not restored it", async () => {
  const w = scene();
  await main([NAME], w.io());
  w.out.length = 0;
  await unlinkMain(["--all"], w.io());
  expect(w.out).toStrictEqual([`unlinked ${NAME}: back on npm 0.3.2`]);
});

it("unlinks every link with --all, through one install", async () => {
  const w = await linkedPair();
  w.out.length = 0;
  expect(await unlinkMain(["--all"], w.io())).toBe(0);
  expect(w.out).toStrictEqual([
    `unlinked ${NAME}: back on npm 0.3.2`,
    "unlinked @workerstack/solo: back on npm (not installed)",
  ]);
  expect(w.installs).toStrictEqual([w.main]);
});

it("prints only the unlinked line when the install is noisy but succeeds", async () => {
  const w = scene();
  await main([NAME], w.io());
  w.out.length = 0;
  const output = "bun install v1.4.4\nrepo sync: up to date\n+ flare@0.3.2\n1 package installed\n";
  expect(await unlinkMain([NAME], w.io({ install: () => ({ code: 0, output }) }))).toBe(0);
  expect(w.out).toStrictEqual([`unlinked ${NAME}: back on npm 0.3.2`]);
  expect(w.err).toStrictEqual([]);
});

it("prints the captured output to stderr and exits 1 when the install fails", async () => {
  const w = scene();
  await main([NAME], w.io());
  w.out.length = 0;
  const output = "error: lockfile had changes\n";
  expect(await unlinkMain([NAME], w.io({ install: () => ({ code: 3, output }) }))).toBe(1);
  expect(w.err).toStrictEqual([
    "repo unlink: bun install failed (exit 3); node_modules may still hold the linked copy:",
    "error: lockfile had changes",
  ]);
  expect(w.out).toStrictEqual([]);
});

it("forgets a link whose copy is gone without installing", async () => {
  const w = scene();
  await main([NAME], w.io());
  fs.rmSync(mod(w.main, NAME), { recursive: true });
  w.out.length = 0;
  expect(await unlinkMain([NAME], w.io())).toBe(0);
  expect(w.installs).toStrictEqual([]);
  expect(w.out).toStrictEqual([`unlinked ${NAME}: back on npm 0.3.2`]);
});

it("says there are no links for --all or a name that is not linked", async () => {
  const w = scene();
  expect(await unlinkMain(["--all"], w.io())).toBe(0);
  expect(await unlinkMain(["nope"], w.io())).toBe(0);
  expect(w.out).toStrictEqual([NONE, NONE]);
  expect(w.installs).toStrictEqual([]);
});

it("removes a marked copy even when the state entry was lost", async () => {
  const w = scene();
  await main([NAME], w.io());
  fs.rmSync(stateFile(w.main));
  expect(await unlinkMain([NAME], w.io())).toBe(0);
  expect(fs.existsSync(mod(w.main, NAME))).toBe(false);
  expect(w.installs).toStrictEqual([w.main]);
});
