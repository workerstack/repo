import { afterEach, expect, it } from "vitest";

import { removePlanted } from "./__fixtures__/planted-repo.ts";
import { change } from "./__fixtures__/red-proof-change.ts";
import { FAIL, fakeVitest, plant, stage } from "./__fixtures__/red-proof-repo.ts";
import { redProof } from "./red-proof.ts";
import { NODE_CONFIG, type TestRun } from "./scripts/node-run.ts";

/** A package's node run proves a test red as its main run does. */
afterEach(removePlanted);

const NODE_FILES = { [NODE_CONFIG]: "export default {};\n" };

it("runs the main run then the node run, and a file only the node run fails proves the change red", () => {
  const root = plant(NODE_FILES);
  stage(root, { "cli/lint/a.test.ts": FAIL });
  const runs: TestRun[] = [];

  const vitest = fakeVitest(
    (_file, _cwd, run) => run === "node",
    (_cwd, _args, run) => runs.push(run),
  );

  expect(redProof(root, change(["A", "cli/lint/a.test.ts"]), { vitest })).toStrictEqual({
    line: "red-proof: 1 of 1 changed test files failed on HEAD",
    ok: true,
  });
  expect(runs).toStrictEqual(["main", "node"]);
});

it("runs only the main run where the package holds no node config", () => {
  const root = plant({});
  stage(root, { "a.test.ts": FAIL });
  const runs: TestRun[] = [];
  redProof(root, change(["A", "a.test.ts"]), {
    vitest: fakeVitest(
      () => true,
      (_cwd, _args, run) => runs.push(run),
    ),
  });
  expect(runs).toStrictEqual(["main"]);
});
