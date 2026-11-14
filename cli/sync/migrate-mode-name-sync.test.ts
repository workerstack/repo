import { expect, it } from "vitest";

import { plain, read, snapshot, sync, write } from "./__fixtures__/copied-install.ts";
import { useTempDirs } from "./__fixtures__/temp-dirs.ts";

useTempDirs();

const RENAMED = "repo sync: renamed mode auto to ask in 1 file under .repo\n";

/** A consumer whose plan still saved `mode: auto`. */
function old(): string {
  const root = plain({});
  write(root, ".repo/plans/1-a.md", "---\nmode: auto\n---\nbody\n");

  return root;
}

it("renames the saved mode once, and a second sync prints nothing about it", async () => {
  const root = old();
  const result = await sync(root, [], true);

  expect([result.code, result.err.join("")]).toStrictEqual([0, ""]);
  expect(result.out.filter((line) => line.includes("renamed mode"))).toStrictEqual([RENAMED]);
  expect(read(root, ".repo/plans/1-a.md")).toBe("---\nmode: ask\n---\nbody\n");
  const again = await sync(root, [], true);

  expect(again.code).toBe(0);
  expect(again.out).not.toContain(RENAMED);
});

it("--check counts the step, exits 1 and changes nothing", async () => {
  const root = old();
  const before = snapshot(root);
  const checked = await sync(root, ["--check"], true);

  expect(checked.err).toStrictEqual(["repo sync: 1 mode step pending; run `bun repo sync`\n"]);
  expect(checked.code).toBe(1);
  expect(snapshot(root)).toStrictEqual(before);
});
