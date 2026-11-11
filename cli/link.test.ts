import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { NAME, mod, put, read, scene, sibling, stateOf, versionIn } from "./__fixtures__/link-world.ts";
import { main, unlinkMain } from "./link.ts";

it("swaps in the packed sibling, warns about a dependency, and says how to undo it", async () => {
  const w = scene();
  expect(await main([NAME], w.io())).toBe(0);
  expect(w.out).toStrictEqual([
    `linked ${NAME} 0.4.0-dev from ${w.flare} (npm had 0.3.2)`,
    `warning: ${NAME} needs zod ^4, this checkout has 3.24.1`,
    `${NAME} is linked; \`bun repo unlink ${NAME}\` puts npm back`,
  ]);
  expect(versionIn(w.main, NAME)).toBe("0.4.0-dev");
  expect(JSON.parse(read(mod(w.main, NAME), ".repo-link"))).toStrictEqual({ name: NAME, source: w.flare });
  expect(w.err).toStrictEqual([]);
});

it("warns when a dependency is not installed at all", async () => {
  const w = scene();
  fs.rmSync(mod(w.main, "zod"), { recursive: true });
  await main([NAME], w.io());
  expect(w.out[1]).toBe(`warning: ${NAME} needs zod ^4, this checkout does not install it`);
});

it("links the bins of the package, as an object or as one file", async () => {
  const w = scene();
  sibling(w.flare, NAME, "0.4.0-dev", { bin: { flare: "cli.js" } });
  put(w.flare, { "cli.js": "#!/usr/bin/env node\n" });
  sibling(path.join(w.base, "solo"), "@workerstack/solo", "1.0.0", { bin: "run.js" });
  put(path.join(w.base, "solo"), { "run.js": "#!/usr/bin/env node\n" });
  await main([NAME], w.io());
  await main(["@workerstack/solo"], w.io());
  expect(fs.readlinkSync(mod(w.main, ".bin", "flare"))).toBe(path.join("..", NAME, "cli.js"));
  expect(fs.readlinkSync(mod(w.main, ".bin", "solo"))).toBe(path.join("..", "@workerstack/solo", "run.js"));
});

it("exits 1 naming the root when no sibling publishes it", async () => {
  const w = scene();
  expect(await main(["nope"], w.io())).toBe(1);
  expect(w.err).toStrictEqual([
    `repo link: no sibling of ${w.main} publishes "nope"; clone it beside this checkout, ` +
      "or map it in workerstack.config.ts `link`",
  ]);
  expect(w.out).toStrictEqual([]);
});

it("exits 1 when the sibling has no install to build with", async () => {
  const w = scene();
  fs.rmSync(path.join(w.flare, "node_modules"), { recursive: true });
  expect(await main([NAME], w.io())).toBe(1);
  expect(w.err).toStrictEqual([
    `repo link: ${w.flare} has no node_modules, so its prepack cannot build; run \`bun install\` there`,
  ]);
  expect(versionIn(w.main, NAME)).toBe("0.3.2");
});

it("exits 1 when this checkout has no install to link into", async () => {
  const w = scene();
  fs.rmSync(mod(w.main), { recursive: true });
  expect(await main([NAME], w.io())).toBe(1);
  expect(w.err).toStrictEqual([`repo link: ${w.main} has no node_modules; run \`bun install\` there`]);
});

it("keeps the last good copy when a pack fails, and the link with it", async () => {
  const w = scene();
  await main([NAME], w.io());
  sibling(w.flare, NAME, "0.5.0", { scripts: { prepack: "echo boom >&2; exit 1" } });
  w.out.length = 0;
  expect(await main([NAME], w.io())).toBe(1);
  const header = `repo link: ${NAME} failed to pack; node_modules keeps the last good copy:\n  `;
  expect(w.err[0]?.startsWith(header)).toBe(true);
  expect(w.err[0]).toContain("boom");
  expect(w.out).toStrictEqual([]);
  expect(versionIn(w.main, NAME)).toBe("0.4.0-dev");
  expect(stateOf(w.main).links[NAME]?.source).toBe(w.flare);
});

it("leaves the npm copy and records nothing when the first pack fails", async () => {
  const w = scene();
  sibling(w.flare, NAME, "0.5.0", { scripts: { prepack: "exit 1" } });
  expect(await main([NAME], w.io())).toBe(1);
  expect(versionIn(w.main, NAME)).toBe("0.3.2");
  expect(fs.existsSync(path.join(w.main, ".repo", "tmp", "links.json"))).toBe(false);
});

it("keeps the old copy's own nested install dir across a swap", async () => {
  const w = scene();
  put(w.main, { [`node_modules/${NAME}/node_modules/inner/x.js`]: "x\n" });
  await main([NAME], w.io());
  expect(read(mod(w.main, NAME, "node_modules", "inner", "x.js"))).toBe("x\n");
});

it("changes neither package.json nor bun.lock through link and unlink", async () => {
  const w = scene();
  const before = [read(w.main, "package.json"), read(w.main, "bun.lock")];
  await main([NAME], w.io());
  await unlinkMain([NAME], w.io());
  expect([read(w.main, "package.json"), read(w.main, "bun.lock")]).toStrictEqual(before);
});
