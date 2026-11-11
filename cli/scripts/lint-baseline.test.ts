import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { cleanTemps, consumer, FLOAT, MAGIC, NN, nonNull, PARAMS, SLOW, WAIT } from "./__fixtures__/baseline-repo.ts";
import { BASELINE_PATH } from "./lint-baseline.constants.ts";
import { checkLintBaseline, excessText, gate, lintReport } from "./lint-baseline.ts";
import { lintMain } from "./lint-main.ts";

const saved = process.cwd();
afterEach(() => {
  process.chdir(saved);
  vi.restoreAllMocks();
  cleanTemps();
});

it("gate names each file and rule over the baseline with both counts", () => {
  const result = gate({ "src/a.ts": { [NN]: 2 } }, { "src/a.ts": { [FLOAT]: 1, [NN]: 3 } }, ["src/a.ts"]);
  expect(result.over.map(excessText)).toStrictEqual([
    `src/a.ts has 1 ${FLOAT}, the baseline allows 0`,
    `src/a.ts has 3 ${NN}, the baseline allows 2`,
  ]);
  expect(result.over.map(({ has, allows }) => has - allows)).toStrictEqual([1, 1]);
  expect(result.next).toStrictEqual({ "src/a.ts": { [NN]: 2 } });
  expect(result.lowered).toStrictEqual([]);
});

it("gate lowers the linted files' entries to their counts, drops zeros, and leaves other files alone", () => {
  const baseline = {
    "src/a.ts": { [NN]: 3, [PARAMS]: 1 },
    "src/b.ts": { [NN]: 1 },
    "src/deleted.ts": { [FLOAT]: 2 },
    "src/other.ts": { [NN]: 5 },
  };
  const result = gate(baseline, { "src/a.ts": { [NN]: 2 } }, ["src/a.ts", "src/b.ts", "src/deleted.ts"]);
  expect(result.over).toStrictEqual([]);
  expect(result.next).toStrictEqual({ "src/a.ts": { [NN]: 2 }, "src/other.ts": { [NN]: 5 } });
  expect(result.lowered).toStrictEqual([
    { file: "src/a.ts", from: 1, rule: PARAMS, to: 0 },
    { file: "src/a.ts", from: 3, rule: NN, to: 2 },
    { file: "src/b.ts", from: 1, rule: NN, to: 0 },
    { file: "src/deleted.ts", from: 2, rule: FLOAT, to: 0 },
  ]);
});

it(
  "the check fails on an excess, an entry above the real count and a gone file, and passes once lowered",
  { timeout: SLOW },
  async () => {
    const baseline = { "src/a.ts": { [NN]: 1 }, "src/b.ts": { [NN]: 3 }, "src/gone.ts": { [NN]: 1 } };
    const root = consumer({
      [BASELINE_PATH]: `${JSON.stringify(baseline, null, 2)}\n`,
      "src/a.ts": nonNull(2),
      "src/b.ts": nonNull(1, "b"),
    });
    expect(await checkLintBaseline(root, [])).toStrictEqual([
      `${BASELINE_PATH}: src/a.ts has 2 ${NN}, the baseline allows 1`,
      `${BASELINE_PATH}: src/b.ts has 1 ${NN}, the baseline allows 3; run \`bun repo lint --baseline\` to lower it`,
      `${BASELINE_PATH}: src/gone.ts is gone; run \`bun repo lint --baseline\``,
    ]);
    fs.writeFileSync(path.join(root, "src/a.ts"), nonNull(1));
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    process.chdir(root);
    expect(await lintMain(["--baseline"])).toBe(0);
    expect(await checkLintBaseline(root, [])).toStrictEqual([]);
  },
);

it("the check holds a repo with no baseline file to zero problems", { timeout: SLOW }, async () => {
  expect(await checkLintBaseline(consumer({ "src/a.ts": nonNull(1) }), [])).toStrictEqual([
    `${BASELINE_PATH}: src/a.ts has 1 ${NN}, the baseline allows 0`,
  ]);
  expect(await checkLintBaseline(consumer({ "src/a.ts": "export const a = 1;\n" }), [])).toStrictEqual([]);
});

it("the check skips a repo with the standards pack off or no config, and reports a broken baseline", async () => {
  expect(await checkLintBaseline(consumer({ "src/a.ts": nonNull(1) }, '["docs"]'), [])).toStrictEqual([]);
  expect(await checkLintBaseline(os.tmpdir(), [])).toStrictEqual([]);
  const unsynced = consumer({ "src/a.ts": nonNull(1) });
  fs.rmSync(path.join(unsynced, ".oxlintrc.json"));
  expect(await checkLintBaseline(unsynced, [])).toStrictEqual([]);
  const broken = consumer({ [BASELINE_PATH]: '{ "src/a.ts": { "x": -1 } }\n' });
  expect(await checkLintBaseline(broken, [])).toStrictEqual([
    `${BASELINE_PATH}: src/a.ts: x: must be a whole number above 0; ` +
      "fix it, or delete it and run `bun repo lint --baseline`",
  ]);
  fs.writeFileSync(path.join(broken, BASELINE_PATH), "{");
  const [unparsed] = await checkLintBaseline(broken, []);
  expect(unparsed).toMatch(new RegExp(`^${BASELINE_PATH.replace(".", "\\.")}: not valid JSON`));
});

it(
  "counts a file oxlint cannot parse as parse-error, and reports an oxlint that fails",
  { timeout: SLOW },
  async () => {
    const root = consumer({ "src/a.ts": "export const = ;\n" });
    expect(await checkLintBaseline(root, [])).toStrictEqual([
      `${BASELINE_PATH}: src/a.ts has 1 parse-error, the baseline allows 0`,
    ]);
    fs.writeFileSync(path.join(root, ".oxlintrc.json"), "{");
    const [failed] = await checkLintBaseline(root, []);
    expect(failed).toMatch(/^oxlint exited 1: Failed to parse oxlint configuration file/);
  },
);

it("the check counts the magic hits it is handed beside oxlint's", { timeout: SLOW }, async () => {
  const root = consumer({
    [BASELINE_PATH]: `${JSON.stringify({ "src/wait.ts": { [MAGIC]: 1 } })}\n`,
    "src/wait.ts": WAIT,
  });
  const line = "src/wait.ts:1:35: error repo(magic-number): 5000 names nothing; give it a named const";
  const magic = [{ file: "src/wait.ts", line, rule: MAGIC }];
  expect(await checkLintBaseline(root, [...magic, ...magic])).toStrictEqual([
    `${BASELINE_PATH}: src/wait.ts has 2 ${MAGIC}, the baseline allows 1`,
  ]);
  expect(await checkLintBaseline(root, magic)).toStrictEqual([]);
});

it("a run over only ignored paths lints nothing and reports no problems", { timeout: SLOW }, () => {
  const root = consumer({ "src/__fixtures__/a.ts": nonNull(1) });
  expect(lintReport(root, ["--fix", "src/__fixtures__/a.ts"])).toStrictEqual({ ok: true, value: [] });
});
