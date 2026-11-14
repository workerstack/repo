import { expect, it } from "vitest";

import { exists, plain, read, snapshot, sync, write } from "./__fixtures__/copied-install.ts";
import { useTempDirs } from "./__fixtures__/temp-dirs.ts";

useTempDirs();

const RENAMED =
  "repo sync: renamed write-plan, write-roadmap, implement-plan and implement-roadmap to their -deep names " +
  "and /do to /rn in 2 files under .repo\n";

const MOVED = "repo sync: moved .repo/skills/write-roadmap to .repo/skills/write-roadmap-deep\n";

const OWN_SKILL =
  "---\nname: write-roadmap\noverrides: write-roadmap\ndescription: Our roadmap skill.\n---\nSplit it.\n";

/** A consumer whose plan and own skill still use an old skill name. */
function old(): string {
  const root = plain({});
  write(root, ".repo/plans/1-a.md", "Next: /implement-plan 1\n");
  write(root, ".repo/skills/write-roadmap/SKILL.md", OWN_SKILL);

  return root;
}

it("renames the names and moves the skill in one sync, and a second sync prints neither", async () => {
  const root = old();
  const result = await sync(root, [], true);

  expect([result.code, result.err.join("")]).toStrictEqual([0, ""]);
  expect(result.out.slice(0, 2)).toStrictEqual([RENAMED, MOVED]);
  expect(read(root, ".repo/plans/1-a.md")).toBe("Next: /implement-plan-deep 1\n");
  expect(read(root, ".repo/skills/write-roadmap-deep/SKILL.md")).toBe(
    "---\nname: write-roadmap-deep\noverrides: write-roadmap-deep\ndescription: Our roadmap skill.\n---\nSplit it.\n",
  );
  expect(exists(root, ".repo/skills/write-roadmap")).toBe(false);
  const again = await sync(root, [], true);

  expect(again.code).toBe(0);
  expect(again.out).not.toContain(RENAMED);
  expect(again.out).not.toContain(MOVED);
});

it("--check counts the steps, exits 1 and changes nothing", async () => {
  const root = old();
  const before = snapshot(root);
  const { code, err } = await sync(root, ["--check"], true);

  expect([code, err.join("")]).toStrictEqual([1, "repo sync: 2 skill steps pending; run `bun repo sync`\n"]);
  expect(snapshot(root)).toStrictEqual(before);
});
