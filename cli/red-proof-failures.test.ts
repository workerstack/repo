import fs from "node:fs";
import { afterEach, expect, it } from "vitest";
import { removePlanted } from "./fixtures/planted-repo.ts";
import { PASS, fakeVitest, outputOf, plant, stage } from "./fixtures/red-proof-repo.ts";
import { redProof, type VitestRun } from "./red-proof.ts";

/** Refusals with no test to run, and vitest runs that leave no report, through the injected runner. */
afterEach(removePlanted);
const change = (...files: [string, string][]) => files.map(([status, file]) => ({ status, path: file }));
const never: VitestRun = () => {
  throw new Error("vitest must not run");
};
const NO_FILE = {
  ok: false,
  problem: "red-proof: no changed vitest test file outside e2e/ to run on HEAD; add one that fails without the change",
};
const A_TEST = change(["A", "a.test.ts"]);

it("refuses a change with only e2e tests and source, without running vitest", () => {
  const root = plant({ "s.ts": "head\n" });
  stage(root, { "e2e/a.test.ts": PASS, "s.ts": "new\n" });
  const files = change(["A", "e2e/a.test.ts"], ["M", "s.ts"]);
  expect(redProof(root, files, { vitest: never })).toStrictEqual(NO_FILE);
});

it("refuses a change with no test, a deleted test or nothing, without running vitest", () => {
  const root = plant({ "s.ts": "head\n", "d.test.ts": PASS });
  expect(redProof(root, change(["M", "s.ts"]), { vitest: never })).toStrictEqual(NO_FILE);
  expect(redProof(root, change(["D", "d.test.ts"]), { vitest: never })).toStrictEqual(NO_FILE);
  expect(redProof(root, [], { vitest: never })).toStrictEqual(NO_FILE);
});

it("refuses when vitest crashed, quoting the last stderr lines", () => {
  const root = plant({ "s.ts": "head\n" });
  stage(root, { "a.test.ts": PASS });
  const crash: VitestRun = () => ({ code: 1, stderr: "one\ntwo\nthree\nfour\nfive\n" });
  expect(redProof(root, A_TEST, { vitest: crash })).toStrictEqual({
    ok: false,
    problem: "red-proof: vitest wrote no report in . (exit 1): three | four | five",
  });
});

it("names the package dir when its run timed out", () => {
  const root = plant({ "cli/package.json": { name: "c" } });
  stage(root, { "cli/a.test.ts": PASS });
  const timeout: VitestRun = () => ({ code: 1, stderr: "vitest timed out after 5ms" });
  expect(redProof(root, change(["A", "cli/a.test.ts"]), { vitest: timeout })).toStrictEqual({
    ok: false,
    problem: "red-proof: vitest wrote no report in cli (exit 1): vitest timed out after 5ms",
  });
});

it.each(["{nope", "{}", '{"testResults":[{"name":1}]}'])("refuses a report that reads %s", (text) => {
  const root = plant({ "s.ts": "head\n" });
  stage(root, { "a.test.ts": PASS });
  const writes: VitestRun = (args) => {
    fs.writeFileSync(outputOf(args), text);
    return { code: 3, stderr: "bad\n" };
  };
  expect(redProof(root, A_TEST, { vitest: writes })).toStrictEqual({
    ok: false,
    problem: "red-proof: vitest wrote no report in . (exit 3): bad",
  });
});

it("hands the runner the nested flags, a json report, no coverage and the default timeout", () => {
  const root = plant({ "s.ts": "head\n" });
  stage(root, { "a.test.ts": PASS });
  const seen: { args: string[]; timeout: number }[] = [];
  const run: VitestRun = (args, cwd, timeout) => {
    seen.push({ args, timeout });
    return fakeVitest(() => true)(args, cwd, timeout);
  };
  redProof(root, A_TEST, { vitest: run });
  const joined = seen.map((call) => call.args.join(" ")).join("");
  expect(seen.map((call) => call.args.slice(0, 4))).toStrictEqual([
    ["run", "a.test.ts", "--fsModuleCache=false", "--reporter=json"],
  ]);
  expect(joined).toMatch(/--outputFile=\S*red-proof-\d+\S*\.json$/);
  expect(joined).not.toContain("overage");
  expect(seen.map((call) => call.timeout)).toStrictEqual([300_000]);
});
