import { expect, it, vi } from "vitest";

import { exists, plain, read, snapshot, sync, write } from "./__fixtures__/copied-install.ts";
import { useTempDirs } from "./__fixtures__/temp-dirs.ts";

useTempDirs();

vi.setConfig({ testTimeout: 120_000 });

const MOVES = [
  "repo sync: moved .tmp/repo/notes-12.md to .repo/scratch/notes-12.md\n",
  "repo sync: moved .tmp/repo/plans to .repo/plans\n",
  "repo sync: moved .tmp/repo/sessions to .repo/tmp/sessions\n",
  "repo sync: removed the empty .tmp/repo\n",
];

/** A consumer with the old `.tmp/repo` layout, one file naming another by its absolute path. */
function old(): string {
  const root = plain({});
  write(root, ".tmp/repo/plans/1-a.md", "plan\n");
  write(root, ".tmp/repo/sessions/s1/approvals.txt", `${root}/.tmp/repo/plans/1-a.md\n`);
  write(root, ".tmp/repo/notes-12.md", "notes\n");

  return root;
}

it("moves .tmp/repo home before the write lines and rewrites the old paths", async () => {
  const root = old();
  const result = await sync(root, [], true);

  expect(result.code).toBe(0);
  expect(result.out.slice(0, 4)).toStrictEqual(MOVES);
  expect(result.out.length).toBeGreaterThan(4);
  expect(read(root, ".repo/scratch/notes-12.md")).toBe("notes\n");
  expect(read(root, ".repo/plans/1-a.md")).toBe("plan\n");
  expect(read(root, ".repo/tmp/sessions/s1/approvals.txt")).toBe(`${root}/.repo/plans/1-a.md\n`);
  expect(exists(root, ".tmp/repo")).toBe(false);
});

it("prints no relocation line the second time and --check passes", async () => {
  const root = old();
  await sync(root, [], true);
  const again = await sync(root, [], true);
  const check = await sync(root, ["--check"], true);

  expect(again.out.join("")).not.toContain("moved");
  expect(again.out.join("")).not.toContain("removed the empty");
  expect(check.code).toBe(0);
});

it("--check counts the steps, exits 1 and moves nothing", async () => {
  const root = old();
  const before = snapshot(root);
  const result = await sync(root, ["--check"], true);

  expect(result.code).toBe(1);
  expect(result.err).toStrictEqual(["repo sync: 4 relocation steps pending; run `bun repo sync`\n"]);
  expect(snapshot(root)).toStrictEqual(before);
});

it.each([
  [[], 1],
  [["--postinstall"], 0],
])("stops on a differing file at both homes with %j, changing nothing", async (args, code) => {
  const root = old();
  write(root, ".repo/plans/1-a.md", "other\n");
  const before = snapshot(root);
  const result = await sync(root, args, true);

  expect(result.code).toBe(code);
  expect(result.err.join("")).toContain("cannot move .tmp/repo/plans/1-a.md");
  expect(snapshot(root)).toStrictEqual(before);
});
