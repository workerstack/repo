import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { cleanTemps, consumer, FLOAT, MAGIC, NN, nonNull, PARAMS, SLOW, WAIT } from "./fixtures/baseline-repo.ts";
import { BASELINE_PATH, checkLintBaseline, excessText, gate, lintReport } from "./lint-baseline.ts";
import { lintMain } from "./lint-main.ts";

const saved = process.cwd();
afterEach(() => {
  process.chdir(saved);
  vi.restoreAllMocks();
  cleanTemps();
});

it("gate names each file and rule over the baseline with both counts", () => {
  const result = gate({ "src/a.ts": { [NN]: 2 } }, { "src/a.ts": { [NN]: 3, [FLOAT]: 1 } }, ["src/a.ts"]);
  expect(result.over.map(excessText)).toEqual([
    `src/a.ts has 3 ${NN}, the baseline allows 2`,
    `src/a.ts has 1 ${FLOAT}, the baseline allows 0`,
  ]);
  expect(result.over.map(({ has, allows }) => has - allows)).toEqual([1, 1]);
  expect(result.next).toEqual({ "src/a.ts": { [NN]: 2 } });
  expect(result.lowered).toEqual([]);
});

it("gate lowers the linted files' entries to their counts, drops zeros, and leaves other files alone", () => {
  const baseline = {
    "src/a.ts": { [NN]: 3, [PARAMS]: 1 },
    "src/b.ts": { [NN]: 1 },
    "src/deleted.ts": { [FLOAT]: 2 },
    "src/other.ts": { [NN]: 5 },
  };
  const result = gate(baseline, { "src/a.ts": { [NN]: 2 } }, ["src/a.ts", "src/b.ts", "src/deleted.ts"]);
  expect(result.over).toEqual([]);
  expect(result.next).toEqual({ "src/a.ts": { [NN]: 2 }, "src/other.ts": { [NN]: 5 } });
  expect(result.lowered).toEqual([
    { file: "src/a.ts", rule: PARAMS, from: 1, to: 0 },
    { file: "src/a.ts", rule: NN, from: 3, to: 2 },
    { file: "src/b.ts", rule: NN, from: 1, to: 0 },
    { file: "src/deleted.ts", rule: FLOAT, from: 2, to: 0 },
  ]);
});

it(
  "the check fails on an excess, an entry above the real count and a gone file, and passes once lowered",
  { timeout: SLOW },
  async () => {
    const baseline = { "src/a.ts": { [NN]: 1 }, "src/b.ts": { [NN]: 3 }, "src/gone.ts": { [NN]: 1 } };
    const root = consumer({
      "src/a.ts": nonNull(2),
      "src/b.ts": nonNull(1, "b"),
      [BASELINE_PATH]: `${JSON.stringify(baseline, null, 2)}\n`,
    });
    expect(await checkLintBaseline(root, [])).toEqual([
      `${BASELINE_PATH}: src/a.ts has 2 ${NN}, the baseline allows 1`,
      `${BASELINE_PATH}: src/b.ts has 1 ${NN}, the baseline allows 3; run \`bun repo lint --baseline\` to lower it`,
      `${BASELINE_PATH}: src/gone.ts is gone; run \`bun repo lint --baseline\``,
    ]);
    fs.writeFileSync(path.join(root, "src/a.ts"), nonNull(1));
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    process.chdir(root);
    expect(await lintMain(["--baseline"])).toBe(0);
    expect(await checkLintBaseline(root, [])).toEqual([]);
  },
);

it("the check holds a repo with no baseline file to zero problems", { timeout: SLOW }, async () => {
  expect(await checkLintBaseline(consumer({ "src/a.ts": nonNull(1) }), [])).toEqual([
    `${BASELINE_PATH}: src/a.ts has 1 ${NN}, the baseline allows 0`,
  ]);
  expect(await checkLintBaseline(consumer({ "src/a.ts": "export const a = 1;\n" }), [])).toEqual([]);
});

it("the check skips a repo with the standards pack off or no config, and reports a broken baseline", async () => {
  expect(await checkLintBaseline(consumer({ "src/a.ts": nonNull(1) }, '["docs"]'), [])).toEqual([]);
  expect(await checkLintBaseline(os.tmpdir(), [])).toEqual([]);
  const unsynced = consumer({ "src/a.ts": nonNull(1) });
  fs.rmSync(path.join(unsynced, ".oxlintrc.json"));
  expect(await checkLintBaseline(unsynced, [])).toEqual([]);
  const broken = consumer({ [BASELINE_PATH]: '{ "src/a.ts": { "x": -1 } }\n' });
  expect(await checkLintBaseline(broken, [])).toEqual([
    `${BASELINE_PATH}: src/a.ts: x: must be a whole number above 0; fix it, or delete it and run \`bun repo lint --baseline\``,
  ]);
  fs.writeFileSync(path.join(broken, BASELINE_PATH), "{");
  expect((await checkLintBaseline(broken, []))[0]).toMatch(
    new RegExp(`^${BASELINE_PATH.replace(".", "\\.")}: not valid JSON`),
  );
});

it(
  "counts a file oxlint cannot parse as parse-error, and reports an oxlint that fails",
  { timeout: SLOW },
  async () => {
    const root = consumer({ "src/a.ts": "export const = ;\n" });
    expect(await checkLintBaseline(root, [])).toEqual([
      `${BASELINE_PATH}: src/a.ts has 1 parse-error, the baseline allows 0`,
    ]);
    fs.writeFileSync(path.join(root, ".oxlintrc.json"), "{");
    expect((await checkLintBaseline(root, []))[0]).toMatch(
      /^oxlint exited 1: Failed to parse oxlint configuration file/,
    );
  },
);

it("the check counts the magic hits it is handed beside oxlint's", { timeout: SLOW }, async () => {
  const root = consumer({
    "src/wait.ts": WAIT,
    [BASELINE_PATH]: `${JSON.stringify({ "src/wait.ts": { [MAGIC]: 1 } })}\n`,
  });
  const line = "src/wait.ts:1:35: error repo(magic-number): 5000 names nothing; give it a named const";
  const magic = [{ file: "src/wait.ts", rule: MAGIC, line }];
  expect(await checkLintBaseline(root, [...magic, ...magic])).toEqual([
    `${BASELINE_PATH}: src/wait.ts has 2 ${MAGIC}, the baseline allows 1`,
  ]);
  expect(await checkLintBaseline(root, magic)).toEqual([]);
});

it("a run over only ignored paths lints nothing and reports no problems", { timeout: SLOW }, () => {
  const root = consumer({ "src/fixtures/a.ts": nonNull(1) });
  expect(lintReport(root, ["--fix", "src/fixtures/a.ts"])).toEqual({ ok: true, value: [] });
});
