import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { useCapturedRun } from "./__fixtures__/captured-run.ts";
import { coverage, FLOORS, floorsOf, MEASURED, project, RUN_MS } from "./__fixtures__/coverage-project.ts";

const { temps } = useCapturedRun();

/** A test file whose `beforeAll` waits `hookMs` and whose test waits `testMs`, with the test's own `options`. */
function slowTest(hookMs: number, testMs: number, options = ""): string {
  return `import { beforeAll, expect, it } from "vitest";
import { sign } from "./a.ts";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeAll(() => wait(${hookMs}));

it("signs a positive number", ${options}async () => {
  await wait(${testMs});
  expect(sign(1)).toBe("pos");
});
`;
}

it("repo coverage: gives a test and a hook past 5 seconds the time to finish", { timeout: RUN_MS }, async () => {
  const root = project(temps);
  fs.writeFileSync(path.join(root, "src/a.test.ts"), slowTest(6_000, 6_000));
  expect(await coverage(root)).toBe(0);
  expect(floorsOf(root)).toStrictEqual({ "src/a.ts": MEASURED });
});

it("repo coverage: keeps a test's own timeout", { timeout: RUN_MS }, async () => {
  const root = project(temps);
  fs.writeFileSync(path.join(root, "src/a.test.ts"), slowTest(0, 2_000, "{ timeout: 1_000 }, "));
  expect(await coverage(root)).toBe(1);
  expect(fs.existsSync(path.join(root, FLOORS))).toBe(false);
});
