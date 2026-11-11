import { afterEach, expect, it } from "vitest";

import { ci, plant } from "./__fixtures__/ci-run.ts";
import { cleanTemps } from "./__fixtures__/turn-repo.ts";

afterEach(cleanTemps);

it("each config's tsc call keeps its incremental build info under .tmp/repo/tsbuildinfo, its path's / as -", () => {
  expect(ci(plant()).calls.tsc).toStrictEqual([
    "--noEmit --incremental --tsBuildInfoFile .tmp/repo/tsbuildinfo/tsconfig.json.tsbuildinfo -p tsconfig.json",
    "--noEmit --incremental --tsBuildInfoFile .tmp/repo/tsbuildinfo/packages-a-tsconfig.json.tsbuildinfo " +
      "-p packages/a/tsconfig.json",
  ]);
});
