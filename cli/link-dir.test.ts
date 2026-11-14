import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { NAME, mod, put, scene, sibling, stateOf, versionIn, workspace } from "./__fixtures__/link-world.ts";
import { main } from "./link.ts";
import { removeTree } from "./remove-tree.ts";

it("links only the packages of a sibling dir that this repo uses", async () => {
  const w = scene();
  const suite = path.join(w.base, "suite");
  workspace(suite, [
    [NAME, "flare"],
    ["@workerstack/unused", "unused"],
  ]);
  removeTree(w.flare);
  expect(await main(["suite"], w.io())).toBe(0);
  expect(w.out.filter((line) => line.startsWith("linked "))).toStrictEqual([
    `linked ${NAME} 1.0.0 from ${path.join(suite, "packages", "flare")} (npm had 0.3.2)`,
  ]);
  expect(fs.existsSync(mod(w.main, "@workerstack", "unused"))).toBe(false);
  expect(Object.keys(stateOf(w.main).links)).toStrictEqual([NAME]);
});

it("finds a package of a workspace sibling by its name", async () => {
  const w = scene();
  workspace(path.join(w.base, "suite"), [["@workerstack/other", "other"]]);
  removeTree(w.flare);
  expect(await main(["@workerstack/other"], w.io())).toBe(0);
  expect(versionIn(w.main, "@workerstack/other")).toBe("1.0.0");
});

it("exits 1 when the dir publishes nothing this repo uses", async () => {
  const w = scene();
  workspace(path.join(w.base, "suite"), [["@workerstack/unused", "unused"]]);
  expect(await main(["suite"], w.io())).toBe(1);
  expect(w.err).toStrictEqual([`repo link: ${path.join(w.base, "suite")} publishes nothing this repo depends on`]);
});

it("counts the dependencies of this checkout's workspace packages as used", async () => {
  const w = scene();
  put(w.main, {
    "package.json": JSON.stringify({ name: "app", private: true, workspaces: ["packages/*"] }),
    "packages/web/package.json": JSON.stringify({ dependencies: { [NAME]: "^0.3.0" }, name: "web" }),
  });
  expect(await main(["flare"], w.io())).toBe(0);
  expect(w.out[0]).toBe(`linked ${NAME} 0.4.0-dev from ${w.flare} (npm had 0.3.2)`);
});

it("ignores directories beside the checkout that are not packages", async () => {
  const w = scene();
  fs.mkdirSync(path.join(w.base, "empty"));
  fs.writeFileSync(path.join(w.base, "stray.txt"), "x");
  put(path.join(w.base, "unnamed"), { "package.json": "{}" });
  put(path.join(w.base, "broken"), { "package.json": "{" });
  expect(await main([NAME], w.io())).toBe(0);
});

it("lets the link config override the sibling that publishes the package", async () => {
  const w = scene();
  const alt = path.join(w.base, "flare-wt");
  sibling(alt, NAME, "0.9.0");
  put(w.main, { "repo.config.ts": `export default { link: { "${NAME}": "../flare-wt" } }\n` });
  expect(await main([NAME], w.io())).toBe(0);
  expect(w.out[0]).toBe(`linked ${NAME} 0.9.0 from ${alt} (npm had 0.3.2)`);
});

it("links a mapped checkout that is not a sibling", async () => {
  const w = scene();
  sibling(path.join(w.base, "far", "away"), NAME, "0.8.0");
  put(w.main, { "repo.config.ts": `export default { link: { "${NAME}": "../far/away" } }\n` });
  removeTree(w.flare);
  expect(await main([NAME], w.io())).toBe(0);
  expect(versionIn(w.main, NAME)).toBe("0.8.0");
});

it("exits 1 when the mapped checkout does not publish the package", async () => {
  const w = scene();
  put(w.main, { "repo.config.ts": `export default { link: { "${NAME}": "../missing" } }\n` });
  expect(await main([NAME], w.io())).toBe(1);
  expect(w.err).toStrictEqual([
    `repo link: ${path.join(w.base, "missing")} does not publish ${NAME}; fix \`link\` in repo.config.ts`,
  ]);
});

it("exits 1 with the config's problems when it is invalid", async () => {
  const w = scene();
  put(w.main, { "repo.config.ts": "export default { link: 1 }\n" });
  expect(await main([NAME], w.io())).toBe(1);
  expect(w.err[0]).toMatch(/^repo link: repo\.config\.ts: link: /);
});

it("links with a config that maps nothing", async () => {
  const w = scene();
  put(w.main, { "repo.config.ts": "export default {}\n" });
  expect(await main([NAME], w.io())).toBe(0);
});
