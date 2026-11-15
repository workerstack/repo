import fs from "node:fs";
import path from "node:path";

import { expect, it, vi } from "vitest";

import { linkedPair } from "./__fixtures__/link-two.ts";
import { NAME, NONE, USAGE, mod, put, scene, sibling, stateFile } from "./__fixtures__/link-world.ts";
import { registerDependent } from "./link-dependents.ts";
import { writeState } from "./link-state.ts";
import { main, unlinkMain } from "./link.ts";
import { removeTree } from "./remove-tree.ts";

it("lists each link with its versions and sync time", async () => {
  const w = scene();
  await main([NAME], w.io());
  w.out.length = 0;
  expect(await main(["status"], w.io())).toBe(0);
  expect(w.out).toStrictEqual([
    `1 link in ${mod(w.main)}`,
    `  ${NAME}  0.4.0-dev  from ${w.flare}  (npm 0.3.2)  synced 08:31`,
  ]);
});

it("says every package comes from npm when nothing is linked", async () => {
  const w = scene();
  expect(await main(["status"], w.io())).toBe(0);
  expect(w.out).toStrictEqual([NONE]);
});

it("pads names, pluralizes, and shows a copy that has no version", async () => {
  const w = await linkedPair();
  fs.rmSync(mod(w.main, "@workerstack", "solo", "package.json"));
  w.out.length = 0;
  await main(["status"], w.io());
  expect(w.out[0]).toBe(`2 links in ${mod(w.main)}`);
  expect(w.out[2]).toBe(
    `  @workerstack/solo   (not installed)  from ${path.join(w.base, "solo")}  (npm none)  synced 08:31`,
  );
});

it("shows a swapped dir whose state entry a lost race dropped", async () => {
  const w = scene();
  await main([NAME], w.io());
  fs.rmSync(stateFile(w.main));
  w.out.length = 0;
  await main(["status"], w.io());
  expect(w.out[1]).toBe(`  ${NAME}  0.4.0-dev  from ${w.flare}  (npm unknown)  synced never`);
});

it("reports status without an install dir as no links", async () => {
  const w = scene();
  removeTree(mod(w.main));
  expect(await main(["status"], w.io())).toBe(0);
  expect(w.out).toStrictEqual([NONE]);
});

it.each(["{", JSON.stringify({ links: {}, version: 2 })])("refuses a state file that reads %s", async (body) => {
  const w = scene();
  put(w.main, { ".repo/tmp/links.json": body });
  expect(await main(["status"], w.io())).toBe(1);
  expect(w.err[0]).toMatch(/^repo link: .*links\.json is not a valid link state \(.+\); delete it to reset$/s);
});

it.each([[[]], [["--bogus"]], [["a", "b"]]])("link %j exits 2 with the usage line", async (argv) => {
  const w = scene();
  expect(await main(argv, w.io())).toBe(2);
  expect(w.err).toStrictEqual([USAGE]);
  expect(w.out).toStrictEqual([]);
});

it.each([[[]], [["a", "b"]], [["--none"]]])("unlink %j exits 2 with the usage line", async (argv) => {
  const w = scene();
  expect(await unlinkMain(argv, w.io())).toBe(2);
  expect(w.err).toStrictEqual([USAGE]);
});

it("reads the real checkout when no io is given", async () => {
  const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  expect(await main(["status"])).toBe(0);
  expect(write).toHaveBeenCalledWith(expect.any(String));
  expect(await unlinkMain(["--all"])).toBe(0);
  write.mockRestore();
});

function dependent(w: { base: string; main: string; flare: string }, name: string, syncedAt: string | null): string {
  const root = path.join(w.base, name);
  fs.mkdirSync(root, { recursive: true });

  if (syncedAt !== null) writeState(root, { [NAME]: { npm: null, source: w.flare, syncedAt } });
  registerDependent(w.main, root, { dir: w.flare, name: NAME });

  return root;
}

it("lists one dependent under a singular header with its sync time", async () => {
  const w = scene();
  const root = dependent(w, "ui", new Date(2026, 10, 12, 20, 5).toISOString());
  expect(await main(["status"], w.io())).toBe(0);
  expect(w.out).toStrictEqual([NONE, "1 dependent links this checkout:", `  ${root}  ${NAME}  synced 20:05`]);
});

it("lists several dependents under a plural header, after the links", async () => {
  const w = scene();
  await main([NAME], w.io());
  w.out.length = 0;
  const b = dependent(w, "b", new Date(2026, 10, 12, 9, 0).toISOString());
  const a = dependent(w, "a", new Date(2026, 10, 12, 10, 30).toISOString());
  await main(["status"], w.io());
  expect(w.out.slice(2)).toStrictEqual([
    "2 dependents link this checkout:",
    `  ${a}  ${NAME}  synced 10:30`,
    `  ${b}  ${NAME}  synced 09:00`,
  ]);
});

it("still lists a dependent after its state write was lost, or its root is gone", async () => {
  const w = scene();
  const lost = dependent(w, "lost", null);
  const gone = path.join(w.base, "gone");
  registerDependent(w.main, gone, { dir: w.flare, name: NAME });
  await main(["status"], w.io());
  expect(w.out).toStrictEqual([
    NONE,
    "2 dependents link this checkout:",
    `  ${gone}  ${NAME}  synced never`,
    `  ${lost}  ${NAME}  synced never`,
  ]);
});

it("lists a package of a dependent whose state links a different one as never synced", async () => {
  const w = scene();
  sibling(path.join(w.base, "solo"), "@workerstack/solo", "1.0.0");
  const root = dependent(w, "ui", new Date(2026, 10, 12, 20, 5).toISOString());
  registerDependent(w.main, root, { dir: path.join(w.base, "solo"), name: "@workerstack/solo" });
  await main(["status"], w.io());
  expect(w.out.slice(2)).toStrictEqual([
    `  ${root}  ${NAME}  synced 20:05`,
    `  ${root}  @workerstack/solo  synced never`,
  ]);
});

it("warns on stderr for a dependents file that does not parse", async () => {
  const w = scene();
  put(w.main, { ".repo/tmp/dependents/bad.json": "{" });
  await main(["status"], w.io());
  expect(w.out).toStrictEqual([NONE]);
  expect(w.err).toHaveLength(1);
});

it("reads standard input once for push --hook when no reader is given", async () => {
  const w = scene();
  const text = vi.spyOn(Bun.stdin, "text").mockResolvedValue("");
  expect(await main(["push", "--hook"], w.io())).toBe(0);
  expect(text).toHaveBeenCalledOnce();
  text.mockRestore();
});
