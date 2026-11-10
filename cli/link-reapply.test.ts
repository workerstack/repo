import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import {
  NAME,
  mod,
  npmCopy,
  put,
  scene,
  sibling,
  stateFile,
  stateOf,
  treeOf,
  versionIn,
} from "./fixtures/link-world.ts";
import { main, unlinkMain } from "./link.ts";
import { reapplyAt, reapplyLinks } from "./link-reapply.ts";

/** What `bun install` does to a linked package: puts the npm copy back. */
function installAgain(root: string, version: string): void {
  fs.rmSync(mod(root, NAME), { recursive: true, force: true });
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
  expect(w.out).toEqual([
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
  fs.rmSync(w.flare, { recursive: true });
  w.out.length = 0;
  expect(await reapplyLinks(w.io())).toBe(0);
  expect(w.err).toEqual([
    `repo link: warning: ${w.flare} is gone; ${NAME} stays on npm; \`bun repo unlink ${NAME}\` forgets it`,
  ]);
  expect(w.out).toEqual([]);
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
  expect(treeOf(mod(w.main))).toEqual(once);
  expect(w.out).toEqual([`repo link: relinked ${NAME} 0.4.0-dev from ${w.flare}`]);
  expect(stateOf(w.main).links[NAME]?.npm).toBe("0.3.3");
});

it("leaves the npm copy after an unlink followed by a real reapply", async () => {
  const w = scene();
  await main([NAME], w.io());
  const install = (root: string) => (installAgain(root, "0.3.2"), { code: 0, output: "" });
  await unlinkMain([NAME], w.io({ install }));
  const before = treeOf(mod(w.main));
  w.out.length = 0;
  expect(await reapplyLinks(w.io())).toBe(0);
  expect(w.out).toEqual([]);
  expect(treeOf(mod(w.main))).toEqual(before);
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
  fs.rmSync(mod(w.main), { recursive: true });
  expect(await reapplyLinks(w.io())).toBe(0);
  expect([w.out, w.err]).toEqual([[], []]);
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
  const git = (_cwd: string, args: readonly string[]) =>
    args.includes("--git-common-dir") ? path.join(w.main, ".git") : tree;
  await reapplyLinks(w.io({ cwd: tree, git }));
  expect(versionIn(w.main, NAME)).toBe("0.4.0-dev");
});

it("reapplies from a directory and prints a line each through the given writers", async () => {
  const w = scene();
  await main([NAME], w.io());
  installAgain(w.main, "0.3.3");
  const lines: string[] = [];
  const writers = {
    stdout: (text: string) => lines.push(`out ${text}`),
    stderr: (text: string) => lines.push(`err ${text}`),
  };
  await reapplyAt(w.main, writers);
  fs.rmSync(w.flare, { recursive: true });
  await reapplyAt(w.main, writers);
  expect(lines).toEqual([
    `out repo link: relinked ${NAME} 0.4.0-dev from ${w.flare}\n`,
    `err repo link: warning: ${w.flare} is gone; ${NAME} stays on npm; \`bun repo unlink ${NAME}\` forgets it\n`,
  ]);
});
