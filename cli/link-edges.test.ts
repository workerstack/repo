import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { NAME, mod, npmCopy, put, read, scene, sibling, stateFile, versionIn } from "./fixtures/link-world.ts";
import { main, unlinkMain } from "./link.ts";

function gitOf(mainDir: string, tree: string) {
  return (_cwd: string, args: readonly string[]) =>
    args.includes("--git-common-dir") ? path.join(mainDir, ".git") : tree;
}

it("links into the main checkout's install from a worktree without one, and finds the same siblings", async () => {
  const w = scene();
  const tree = path.join(w.base, "repo-wt");
  fs.mkdirSync(tree);
  const over = { cwd: tree, git: gitOf(w.main, tree) };
  expect(await main([NAME], w.io(over))).toBe(0);
  expect(versionIn(w.main, NAME)).toBe("0.4.0-dev");
  expect(fs.existsSync(mod(tree))).toBe(false);
  await unlinkMain([NAME], w.io(over));
  expect(w.installs).toStrictEqual([w.main]);
});

it("links into the worktree's own install when it has one", async () => {
  const w = scene();
  const tree = path.join(w.base, "repo-wt");
  put(tree, { "package.json": JSON.stringify({ dependencies: { [NAME]: "^0.3.0" }, name: "app" }) });
  npmCopy(tree, NAME, "0.3.1");
  await main([NAME], w.io({ cwd: tree, git: gitOf(w.main, tree) }));
  expect(versionIn(tree, NAME)).toBe("0.4.0-dev");
  expect(versionIn(w.main, NAME)).toBe("0.3.2");
});

it("works outside a git checkout, beside the current directory", async () => {
  const w = scene();
  expect(await main([NAME], w.io({ git: () => null }))).toBe(0);
  expect(versionIn(w.main, NAME)).toBe("0.4.0-dev");
});

it("remembers the npm version across a second link, and says none after a lost entry", async () => {
  const w = scene();
  await main([NAME], w.io());
  w.out.length = 0;
  await main([NAME], w.io());
  expect(w.out[0]).toBe(`linked ${NAME} 0.4.0-dev from ${w.flare} (npm had 0.3.2)`);
  fs.rmSync(stateFile(w.main));
  w.out.length = 0;
  await main([NAME], w.io());
  expect(w.out[0]).toBe(`linked ${NAME} 0.4.0-dev from ${w.flare} (npm had none)`);
});

it("judges required peers only, and ranges only", async () => {
  const w = scene();
  sibling(w.flare, NAME, "0.4.0-dev", {
    dependencies: { local: "file:../local", scoped: "npm:other@1", zod: "^3" },
    peerDependencies: { optional: "^1", plain: "^2", react: "^19" },
    peerDependenciesMeta: { optional: { optional: true }, plain: {} },
  });
  await main([NAME], w.io());
  expect(w.out.slice(1, -1)).toStrictEqual([
    `warning: ${NAME} needs plain ^2, this checkout does not install it`,
    `warning: ${NAME} needs react ^19, this checkout does not install it`,
  ]);
});

it("links a package that depends on nothing", async () => {
  const w = scene();
  sibling(w.flare, NAME, "0.4.0-dev", { dependencies: undefined });
  await main([NAME], w.io());
  expect(w.out).toStrictEqual([
    `linked ${NAME} 0.4.0-dev from ${w.flare} (npm had 0.3.2)`,
    `${NAME} is linked; \`bun repo unlink ${NAME}\` puts npm back`,
  ]);
});

it("reports a pack whose package.json lost its name, and keeps npm", async () => {
  const w = scene();
  const script = "require('fs').writeFileSync('package.json','{}')";
  sibling(w.flare, NAME, "0.4.0-dev", { scripts: { prepack: `node -e "${script}"` } });
  expect(await main([NAME], w.io())).toBe(1);
  expect(versionIn(w.main, NAME)).toBe("0.3.2");
});

it("exits 1 when this checkout's package.json cannot be read", async () => {
  const w = scene();
  put(w.main, { "package.json": "{" });
  expect(await main([NAME], w.io())).toBe(1);
  expect(w.err[0]).toMatch(/^repo link: package\.json: not valid JSON/);
  expect(read(w.main, "package.json")).toBe("{");
});
