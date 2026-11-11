import fs from "node:fs";
import path from "node:path";

import { expect, it, vi } from "vitest";

import { NAME, NONE, USAGE, mod, put, scene, sibling, stateFile } from "./fixtures/link-world.ts";
import { main, unlinkMain } from "./link.ts";

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
  const w = scene();
  sibling(path.join(w.base, "solo"), "@workerstack/solo", "1.0.0");
  await main([NAME], w.io());
  await main(["@workerstack/solo"], w.io());
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
  fs.rmSync(mod(w.main), { recursive: true });
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
