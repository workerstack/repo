import { afterAll, expect, it } from "vitest";

import { removePlanted } from "../__fixtures__/planted-repo.ts";
import { configTwins } from "./__fixtures__/config-world.ts";
import { apiDiff } from "./api-diff.ts";

afterAll(removePlanted);

it("finds no change between two copies of this checkout's config types", { timeout: 120_000 }, async () => {
  const world = await configTwins();

  expect(await apiDiff(world.project, world.old, world.next)).toStrictEqual([]);
});
