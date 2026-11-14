import { spawnSync } from "node:child_process";

import { expect, it } from "vitest";

import { exists, fixture, sync, useSyncKit, write } from "./__fixtures__/sync-kit.ts";

useSyncKit();

/** A `.json` copy a `repo check` of 0.2.0-rc.0 left when it was killed, named for a pid no process holds now. */
function leftCopy(root: string): string {
  const name = `.oxlintrc.unskipped-${spawnSync(process.execPath, ["-e", ""]).pid}.json`;
  write(root, name, "{}\n");

  return name;
}

it("removes a config copy a stopped repo check left at the root, and says so", async () => {
  const root = fixture();
  const name = leftCopy(root);

  const synced = await sync(root);

  expect(synced.code).toBe(0);
  expect(synced.stdout).toContain(`repo sync: removed ${name}, left by a repo check that stopped\n`);
  expect(exists(root, name)).toBe(false);
});

it("keeps the copy under --check", async () => {
  const root = fixture();
  const name = leftCopy(root);

  const checked = await sync(root, "--check");

  expect(checked.stdout + checked.stderr).not.toContain(name);
  expect(exists(root, name)).toBe(true);
});
