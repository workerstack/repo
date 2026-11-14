import fs from "node:fs";

import { expect, it } from "vitest";

import {
  NAME,
  type World,
  hoistingSuite,
  installedFile,
  installs,
  mod,
  put,
  resolvedFrom,
  scene,
  sibling,
  treeOf,
} from "./__fixtures__/link-world.ts";
import { main, unlinkMain } from "./link.ts";

/** What link prints for a dependency neither checkout installs in range, with the consumer's zod 3.24.1. */
const ZOD_WARNING = `warning: ${NAME} needs zod ^4, this checkout has 3.24.1`;

/** Links `NAME`; the zod the copy then resolves, and whether link warned about it. */
async function linkedZod(w: World): Promise<{ file: string; warned: boolean }> {
  await main([NAME], w.io());

  return { file: resolvedFrom(w.main, "zod"), warned: w.out.includes(ZOD_WARNING) };
}

it("gives the linked copy a dependency only the sibling installs, with no warning", async () => {
  const w = scene();
  installs(w.flare, "zod", "4.1.0");
  expect(await main([NAME], w.io())).toBe(0);
  expect(resolvedFrom(w.main, "zod")).toBe(installedFile(w.flare, "zod"));
  expect(w.out).not.toContain(ZOD_WARNING);
});

it("links a dependency a workspace sibling hoists to its root", async () => {
  const w = scene();
  const suite = hoistingSuite(w);
  expect(await main(["suite"], w.io())).toBe(0);
  expect(resolvedFrom(w.main, "zod")).toBe(installedFile(suite, "zod"));
});

it("links a scoped dependency, and keeps the link through a relink", async () => {
  const w = scene();
  sibling(w.flare, NAME, "0.4.0-dev", { dependencies: { "@scope/util": "^2" } });
  installs(w.flare, "@scope/util", "2.0.1");
  await main([NAME], w.io());
  await main([NAME], w.io());
  expect(resolvedFrom(w.main, "@scope/util")).toBe(installedFile(w.flare, "@scope/util"));
});

it("keeps the consumer's copy when it is in range", async () => {
  const w = scene();
  installs(w.main, "zod", "4.0.0");
  installs(w.flare, "zod", "4.1.0");
  await main([NAME], w.io());
  expect(resolvedFrom(w.main, "zod")).toBe(installedFile(w.main, "zod"));
});

it("links nothing and warns when the sibling's copy is out of range", async () => {
  const w = scene();
  installs(w.flare, "zod", "3.9.0");
  expect(await linkedZod(w)).toStrictEqual({ file: installedFile(w.main, "zod"), warned: true });
});

it("does not look above the sibling's checkout", async () => {
  const w = scene();
  put(w.flare, { ".git/HEAD": "ref: refs/heads/main\n" });
  installs(w.base, "zod", "4.1.0");
  expect(await linkedZod(w)).toStrictEqual({ file: installedFile(w.main, "zod"), warned: true });
});

it("replaces a nested copy out of range that the npm copy left", async () => {
  const w = scene();
  installs(mod(w.main, NAME), "zod", "3.0.0");
  installs(w.flare, "zod", "4.1.0");
  await main([NAME], w.io());
  expect(resolvedFrom(w.main, "zod")).toBe(installedFile(w.flare, "zod"));
});

it("drops the link of a dependency the sibling no longer has, and keeps the sibling's copy", async () => {
  const w = scene();
  installs(w.flare, "zod", "4.1.0");
  await main([NAME], w.io());
  sibling(w.flare, NAME, "0.5.0", { dependencies: {} });
  await main([NAME], w.io());
  expect(fs.lstatSync(mod(w.main, NAME, "node_modules", "zod"), { throwIfNoEntry: false })).toBeUndefined();
  expect(fs.existsSync(installedFile(w.flare, "zod"))).toBe(true);
});

it("leaves the same tree when it links twice", async () => {
  const w = scene();
  installs(w.flare, "zod", "4.1.0");
  await main([NAME], w.io());
  const first = treeOf(mod(w.main, NAME));
  await main([NAME], w.io());
  expect(treeOf(mod(w.main, NAME))).toStrictEqual(first);
});

it("keeps the sibling's copy of a linked dependency through unlink", async () => {
  const w = scene();
  installs(w.flare, "zod", "4.1.0");
  await main([NAME], w.io());
  expect(await unlinkMain([NAME], w.io())).toBe(0);
  expect(fs.existsSync(installedFile(w.flare, "zod"))).toBe(true);
});
