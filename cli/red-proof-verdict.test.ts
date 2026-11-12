import { afterEach, expect, it } from "vitest";

import { git, removePlanted } from "./__fixtures__/planted-repo.ts";
import { change } from "./__fixtures__/red-proof-change.ts";
import { FAIL, NEEDS_X, PASS, plant, stage } from "./__fixtures__/red-proof-repo.ts";
import { redProof } from "./red-proof.ts";

/** The verdict on a real vitest run against HEAD's source in a planted repo. */
const SLOW = { timeout: 60_000 };

afterEach(removePlanted);

function readsV(n: number) {
  return `import { expect, it } from "vitest";\nimport { v } from "./v.ts";\nit("v", () => expect(v).toBe(${n}));\n`;
}

function red(failed: number, total: number) {
  return {
    line: `red-proof: ${failed} of ${total} changed test files failed on HEAD`,
    ok: true,
  };
}

it("proves red when a changed test fails on HEAD's source", SLOW, () => {
  const root = plant({ "v.test.ts": readsV(1), "v.ts": "export const v = 1;\n" });
  stage(root, { "v.test.ts": readsV(2), "v.ts": "export const v = 2;\n" });
  expect(redProof(root, change(["M", "v.ts"], ["M", "v.test.ts"]))).toStrictEqual(red(1, 1));
  expect(git(root, "status", "--porcelain")).toBe("M  v.test.ts\nM  v.ts\n");
});

it("refuses a changed test that also passes on HEAD, naming it", SLOW, () => {
  const root = plant({ "v.ts": "export const v = 1;\n" });
  stage(root, { "a.test.ts": PASS, "v.ts": "export const v = 2;\n" });
  expect(redProof(root, change(["M", "v.ts"], ["A", "a.test.ts"]))).toStrictEqual({
    ok: false,
    problem:
      "red-proof: no changed test file fails on HEAD's source (a.test.ts passed); " +
      "a feat or fix needs one that fails without the change",
  });
});

it("fails a test of a new source file, which is absent on HEAD", SLOW, () => {
  const root = plant({ "keep.txt": "k\n" });
  stage(root, { "x.test.ts": NEEDS_X, "x.ts": "export const x = () => 1;\n" });
  expect(redProof(root, change(["A", "x.ts"], ["A", "x.test.ts"]))).toStrictEqual(red(1, 1));
});

it("counts a failing test and a passing one apart", SLOW, () => {
  const root = plant({ "keep.txt": "k\n" });
  stage(root, { "a.test.ts": FAIL, "b.test.ts": PASS });
  expect(redProof(root, change(["A", "a.test.ts"], ["A", "b.test.ts"]))).toStrictEqual(red(1, 2));
});
