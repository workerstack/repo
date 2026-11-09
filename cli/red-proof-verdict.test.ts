import { afterEach, expect, it } from "vitest";
import { git, removePlanted } from "./fixtures/planted-repo.ts";
import { FAIL, NEEDS_X, PASS, plant, stage } from "./fixtures/red-proof-repo.ts";
import { redProof } from "./red-proof.ts";

/** The verdict on a real vitest run against HEAD's source in a planted repo. */
const SLOW = { timeout: 60_000 };
afterEach(removePlanted);
const change = (...files: [string, string][]) => files.map(([status, file]) => ({ status, path: file }));
const readsV = (n: number) =>
  `import { expect, it } from "vitest";\nimport { v } from "./v.ts";\nit("v", () => expect(v).toBe(${n}));\n`;
const RED = (failed: number, total: number) => ({
  ok: true,
  line: `red-proof: ${failed} of ${total} changed test files failed on HEAD`,
});

it("proves red when a changed test fails on HEAD's source", SLOW, () => {
  const root = plant({ "v.ts": "export const v = 1;\n", "v.test.ts": readsV(1) });
  stage(root, { "v.ts": "export const v = 2;\n", "v.test.ts": readsV(2) });
  expect(redProof(root, change(["M", "v.ts"], ["M", "v.test.ts"]))).toEqual(RED(1, 1));
  expect(git(root, "status", "--porcelain")).toBe("M  v.test.ts\nM  v.ts\n");
});

it("refuses a changed test that also passes on HEAD, naming it", SLOW, () => {
  const root = plant({ "v.ts": "export const v = 1;\n" });
  stage(root, { "v.ts": "export const v = 2;\n", "a.test.ts": PASS });
  expect(redProof(root, change(["M", "v.ts"], ["A", "a.test.ts"]))).toEqual({
    ok: false,
    problem:
      "red-proof: no changed test file fails on HEAD's source (a.test.ts passed); a feat or fix needs one that fails without the change",
  });
});

it("fails a test of a new source file, which is absent on HEAD", SLOW, () => {
  const root = plant({ "keep.txt": "k\n" });
  stage(root, { "x.ts": "export const x = () => 1;\n", "x.test.ts": NEEDS_X });
  expect(redProof(root, change(["A", "x.ts"], ["A", "x.test.ts"]))).toEqual(RED(1, 1));
});

it("counts a failing test and a passing one apart", SLOW, () => {
  const root = plant({ "keep.txt": "k\n" });
  stage(root, { "a.test.ts": FAIL, "b.test.ts": PASS });
  expect(redProof(root, change(["A", "a.test.ts"], ["A", "b.test.ts"]))).toEqual(RED(1, 2));
});
