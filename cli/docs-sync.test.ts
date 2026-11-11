import { expect, it } from "vitest";

import { docsRun, json, tempRoot } from "./__fixtures__/docs-fixture.ts";
import { main } from "./docs.ts";

const FILES = { "package.json": json({ name: "app", private: true }), "references/INDEX.md": "# Index\n" };

it("syncs first, then runs the same checks", async () => {
  const root = tempRoot(FILES);
  const run = docsRun(root);
  expect(await main([], run.io)).toBe(0);
  expect(run.synced).toStrictEqual([root]);
  expect(run.out).toStrictEqual(["docs ok: 1 references, 0 examples, 0 exports\n"]);
});

it("stops with sync's exit code when sync fails", async () => {
  const run = docsRun(tempRoot(FILES), {}, 1);
  expect(await main([], run.io)).toBe(1);
  expect(run.out).toStrictEqual([]);
});

it("prints usage and exits 2 for anything else", async () => {
  const run = docsRun(tempRoot(FILES));
  expect(await main(["--fix"], run.io)).toBe(2);
  expect(await main(["--check", "extra"], run.io)).toBe(2);
  expect(run.err).toStrictEqual(["usage: repo docs [--check]\n", "usage: repo docs [--check]\n"]);
  expect(run.synced).toStrictEqual([]);
});
