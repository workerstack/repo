import { expect, it, vi } from "vitest";

import { plain, read, snapshot, sync, write } from "./__fixtures__/copied-install.ts";
import { useTempDirs } from "./__fixtures__/temp-dirs.ts";

useTempDirs();

vi.setConfig({ testTimeout: 120_000 });

const NOTE =
  "repo sync: renamed strategy review-fast to spawn-fast and review-deep to spawn-deep in 3 files under .repo\n";

/** A consumer whose plans and handoff still carry the old strategy names. */
function old(): string {
  const root = plain({});
  write(root, ".repo/plans/1-a.md", "---\nstrategy: review-fast\n---\nplan\n");
  write(root, ".repo/plans/2-b.md", "---\nstrategy: review-deep\n---\nplan\n");
  write(root, ".repo/handoffs/h.md", "done (strategy: review-deep)\n");

  return root;
}

it("renames the strategies before the write lines", async () => {
  const root = old();
  const result = await sync(root, [], true);

  expect(result.code).toBe(0);
  expect(result.out[0]).toBe(NOTE);
  expect(result.out.length).toBeGreaterThan(1);
  expect(read(root, ".repo/plans/1-a.md")).toBe("---\nstrategy: spawn-fast\n---\nplan\n");
  expect(read(root, ".repo/plans/2-b.md")).toBe("---\nstrategy: spawn-deep\n---\nplan\n");
  expect(read(root, ".repo/handoffs/h.md")).toBe("done (strategy: spawn-deep)\n");
});

it("prints no rename line the second time", async () => {
  const root = old();
  await sync(root, [], true);
  const again = await sync(root, [], true);

  expect(again.out.join("")).not.toContain("renamed strategy");
});

it("--check counts the step, exits 1 and changes nothing", async () => {
  const root = old();
  const before = snapshot(root);
  const { code, err } = await sync(root, ["--check"], true);

  expect([code, err.join("")]).toStrictEqual([1, "repo sync: 1 strategy step pending; run `bun repo sync`\n"]);
  expect(snapshot(root)).toStrictEqual(before);
});

it("moves .tmp/repo home and renames in one sync", async () => {
  const root = plain({});
  write(root, ".tmp/repo/plans/1-a.md", "---\nstrategy: review-deep\n---\nplan\n");
  const result = await sync(root, [], true);

  expect(result.out.slice(0, 3)).toStrictEqual([
    "repo sync: moved .tmp/repo/plans to .repo/plans\n",
    "repo sync: removed the empty .tmp/repo\n",
    "repo sync: renamed strategy review-fast to spawn-fast and review-deep to spawn-deep in 1 file under .repo\n",
  ]);
  expect(read(root, ".repo/plans/1-a.md")).toBe("---\nstrategy: spawn-deep\n---\nplan\n");
});
