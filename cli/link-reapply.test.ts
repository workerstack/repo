import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import {
  NAME,
  hoistingSuite,
  installedFile,
  mod,
  npmCopy,
  put,
  resolvedFrom,
  scene,
  sibling,
  stateFile,
  stateOf,
  treeOf,
  versionIn,
} from "./__fixtures__/link-world.ts";
import { reapplyAt, reapplyLinks } from "./link-reapply.ts";
import { main, unlinkMain } from "./link.ts";
import { removeTree } from "./remove-tree.ts";

/** What `bun install` does to a linked package: puts the npm copy back. */
function installAgain(root: string, version: string): void {
  removeTree(mod(root, NAME));
  npmCopy(root, NAME, version);
}

it("relinks each link after an install, in name order, and records the npm version it found", async () => {
  const w = scene();
  sibling(path.join(w.base, "solo"), "@workerstack/solo", "1.0.0");
  await main(["@workerstack/solo"], w.io());
  await main([NAME], w.io());
  installAgain(w.main, "0.3.3");
  w.out.length = 0;
  expect(await reapplyLinks(w.io())).toBe(0);
  expect(w.out).toStrictEqual([
    `repo link: relinked ${NAME} 0.4.0-dev from ${w.flare}`,
    `repo link: relinked @workerstack/solo 1.0.0 from ${path.join(w.base, "solo")}`,
  ]);
  expect(versionIn(w.main, NAME)).toBe("0.4.0-dev");
  expect(stateOf(w.main).links[NAME]?.npm).toBe("0.3.3");
});

it("warns for a source that is gone and leaves npm in place", async () => {
  const w = scene();
  await main([NAME], w.io());
  installAgain(w.main, "0.3.3");
  removeTree(w.flare);
  w.out.length = 0;
  expect(await reapplyLinks(w.io())).toBe(0);
  expect(w.err).toStrictEqual([
    `repo link: warning: ${w.flare} is gone; ${NAME} stays on npm; \`bun repo unlink ${NAME}\` forgets it`,
  ]);
  expect(w.out).toStrictEqual([]);
  expect(versionIn(w.main, NAME)).toBe("0.3.3");
});

it("leaves the same tree when it runs twice", async () => {
  const w = scene();
  await main([NAME], w.io());
  installAgain(w.main, "0.3.3");
  await reapplyLinks(w.io());
  const once = treeOf(mod(w.main));
  w.out.length = 0;
  await reapplyLinks(w.io());
  expect(treeOf(mod(w.main))).toStrictEqual(once);
  expect(w.out).toStrictEqual([`repo link: relinked ${NAME} 0.4.0-dev from ${w.flare}`]);
  expect(stateOf(w.main).links[NAME]?.npm).toBe("0.3.3");
});

function install(root: string) {
  return (installAgain(root, "0.3.2"), { code: 0, output: "" });
}

it("leaves the npm copy after an unlink followed by a real reapply", async () => {
  const w = scene();
  await main([NAME], w.io());
  await unlinkMain([NAME], w.io({ install }));
  const before = treeOf(mod(w.main));
  w.out.length = 0;
  expect(await reapplyLinks(w.io())).toBe(0);
  expect(w.out).toStrictEqual([]);
  expect(treeOf(mod(w.main))).toStrictEqual(before);
  expect(versionIn(w.main, NAME)).toBe("0.3.2");
});

it("warns and keeps the copy when the pack fails", async () => {
  const w = scene();
  await main([NAME], w.io());
  sibling(w.flare, NAME, "0.5.0", { scripts: { prepack: "echo boom >&2; exit 1" } });
  expect(await reapplyLinks(w.io())).toBe(0);
  expect(
    w.err[0]?.startsWith(`repo link: warning: ${NAME} failed to pack; node_modules keeps the last good copy:`),
  ).toBe(true);
  expect(versionIn(w.main, NAME)).toBe("0.4.0-dev");
});

it("says nothing and writes nothing with no links, no install dir, or no state", async () => {
  const w = scene();
  expect(await reapplyLinks(w.io())).toBe(0);
  expect(fs.existsSync(stateFile(w.main))).toBe(false);
  removeTree(mod(w.main));
  expect(await reapplyLinks(w.io())).toBe(0);
  expect([w.out, w.err]).toStrictEqual([[], []]);
});

it("warns instead of failing when the state file is unreadable", async () => {
  const w = scene();
  put(w.main, { ".repo/tmp/links.json": "{" });
  expect(await reapplyLinks(w.io())).toBe(0);
  expect(w.err[0]).toMatch(/^repo link: warning: .*links\.json is not a valid link state/);
});

it("reapplies into the main checkout's install from a worktree without one", async () => {
  const w = scene();
  await main([NAME], w.io());
  installAgain(w.main, "0.3.3");
  const tree = path.join(w.base, "repo-wt");
  fs.mkdirSync(tree);

  function git(_cwd: string, args: readonly string[]) {
    return args.includes("--git-common-dir") ? path.join(w.main, ".git") : tree;
  }

  await reapplyLinks(w.io({ cwd: tree, git }));
  expect(versionIn(w.main, NAME)).toBe("0.4.0-dev");
});

it("reapplies from a directory and prints a line each through the given writers", async () => {
  const w = scene();
  await main([NAME], w.io());
  installAgain(w.main, "0.3.3");
  const lines: string[] = [];

  const writers = {
    stderr: (text: string) => lines.push(`err ${text}`),
    stdout: (text: string) => lines.push(`out ${text}`),
  };

  await reapplyAt(w.main, writers);
  removeTree(w.flare);
  await reapplyAt(w.main, writers);
  expect(lines).toStrictEqual([
    `out repo link: relinked ${NAME} 0.4.0-dev from ${w.flare}\n`,
    `err repo link: warning: ${w.flare} is gone; ${NAME} stays on npm; \`bun repo unlink ${NAME}\` forgets it\n`,
  ]);
});

it("links a workspace sibling's hoisted dependency again after an install put npm's copy back", async () => {
  const w = scene();
  const suite = hoistingSuite(w);
  await main(["suite"], w.io());
  installAgain(w.main, "0.3.3");
  await reapplyLinks(w.io());
  expect(resolvedFrom(w.main, "zod")).toBe(installedFile(suite, "zod"));
});
