import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, expect, it, vi } from "vitest";

import { cleanTemps, consumer, NN, nonNull, SLOW } from "./__fixtures__/baseline-repo.ts";
import {
  GUARD_HIT,
  GUARD_SOURCE,
  GUARD_TEST,
  planted,
  spies,
  STRING_HIT,
  STRING_SOURCE,
} from "./__fixtures__/lint-scripts-kit.ts";
import { BASELINE_PATH } from "./lint-baseline.constants.ts";
import { lintMain } from "./lint-main.ts";
import { captureBun } from "./lint.ts";

const saved = process.cwd();
const CLI = fileURLToPath(new URL("../../bin/repo.ts", import.meta.url));

afterEach(() => {
  process.chdir(saved);
  vi.restoreAllMocks();
  cleanTemps();
});

/** Everything the run wrote, stdout then stderr, as lines. */
function printed(out: () => string[], err: () => string[]): string[] {
  return [...out(), ...err()];
}

/** The baseline file as `counts`, written the way the repo holds it. */
function baselineOf(counts: Record<string, Record<string, number>>): string {
  return `${JSON.stringify(counts, null, 2)}\n`;
}

const NN_LINE = /^src\/a\.ts:\d+:\d+: .*typescript\(no-non-null-assertion\)/;

it.each([[["--format", "default"]], [["-f", "default"]], [["--format=default"]]])(
  "lint %j gates the text format as it gates no format",
  { timeout: SLOW },
  async (format) => {
    const { stdout, stderr } = spies();
    process.chdir(planted());
    expect(await lintMain([...format, "src/a.ts"])).toBe(1);
    expect(printed(stdout, stderr)).toStrictEqual([
      `${STRING_HIT}\n`,
      "repo lint: src/a.ts has 1 repo(magic-string), the baseline allows 0; fix the new one\n",
    ]);
  },
);

it("lint names why oxlint gave no report and fails", { timeout: SLOW }, async () => {
  const { stdout, stderr } = spies();
  process.chdir(planted());
  expect(await lintMain(["--no-such-flag"])).toBe(1);
  expect(stdout()).toStrictEqual([]);
  expect(stderr()).toStrictEqual([expect.stringMatching(/^repo lint: oxlint exited [1-9]\d*: .*--no-such-flag/s)]);
});

it(
  "lint within the baseline prints only the count, exits 0, and never rewrites the baseline",
  { timeout: SLOW },
  async () => {
    // The baseline allows more than the repo has: a lowering gate would rewrite it; lint must not.
    const held = baselineOf({ "src/a.ts": { [NN]: 3 }, "src/gone.ts": { [NN]: 1 } });
    const root = consumer({ [BASELINE_PATH]: held, "src/a.ts": nonNull(2) });
    const { stdout, stderr } = spies();
    process.chdir(root);
    expect(await lintMain([])).toBe(0);
    expect(printed(stdout, stderr)).toStrictEqual(["repo lint: 2 hits within the baseline; --all prints them\n"]);
    expect(fs.readFileSync(path.join(root, BASELINE_PATH), "utf8")).toBe(held);
  },
);

it("lint with no hit at all says so and exits 0", { timeout: SLOW }, async () => {
  const { stdout, stderr } = spies();
  process.chdir(consumer({ [BASELINE_PATH]: "{}\n", "src/b.ts": "export const b = 1;\n" }));
  expect(await lintMain([])).toBe(0);
  expect(printed(stdout, stderr)).toStrictEqual(["repo lint: no hits\n"]);
});

it(
  "lint prints the hits of an oxlint rule over its baseline, then the excess line, and exits 1",
  { timeout: SLOW },
  async () => {
    // src/b.ts is within its entry: its hit is counted, never printed.
    const root = consumer({
      [BASELINE_PATH]: baselineOf({ "src/a.ts": { [NN]: 1 }, "src/b.ts": { [NN]: 1 } }),
      "src/a.ts": nonNull(2),
      "src/b.ts": nonNull(1, "b"),
    });

    const { stdout, stderr } = spies();
    process.chdir(root);
    expect(await lintMain([])).toBe(1);
    const lines = printed(stdout, stderr);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(NN_LINE);
    expect(lines[1]).toMatch(NN_LINE);
    expect(lines[2]).toBe(`repo lint: src/a.ts has 2 ${NN}, the baseline allows 1; fix the new one\n`);
  },
);

it("lint counts a script hit over its baseline the same way", { timeout: SLOW }, async () => {
  const { stdout, stderr } = spies();
  process.chdir(consumer({ [BASELINE_PATH]: "{}\n", "src/a.ts": STRING_SOURCE, "src/b.ts": "export const b = 1;\n" }));
  expect(await lintMain(["src/a.ts"])).toBe(1);
  expect(printed(stdout, stderr)).toStrictEqual([
    `${STRING_HIT}\n`,
    "repo lint: src/a.ts has 1 repo(magic-string), the baseline allows 0; fix the new one\n",
  ]);
});

it("lint with paths counts a script hit in a file outside them, as precommit does", { timeout: SLOW }, async () => {
  const sources = { "src/is-user.test.ts": GUARD_TEST, "src/is-user.ts": GUARD_SOURCE };
  const root = consumer({ [BASELINE_PATH]: "{}\n", ...sources });
  const { stdout, stderr, clear } = spies();
  process.chdir(root);
  expect(await lintMain(["src/is-user.test.ts"])).toBe(1);
  expect(printed(stdout, stderr)).toStrictEqual([
    `${GUARD_HIT}\n`,
    "repo lint: src/is-user.ts has 1 repo(guard-rejects), the baseline allows 0; fix the new one\n",
  ]);
  clear();
  fs.writeFileSync(path.join(root, BASELINE_PATH), baselineOf({ "src/is-user.ts": { "repo(guard-rejects)": 1 } }));
  expect(await lintMain(["src/is-user.test.ts"])).toBe(0);
  expect(printed(stdout, stderr)).toStrictEqual(["repo lint: 1 hit within the baseline; --all prints them\n"]);
});

it("lint --all prints every hit, baselined or not, and exits 1", { timeout: SLOW }, async () => {
  const counts = { "src/a.ts": { [NN]: 1 }, "src/b.ts": { "repo(magic-string)": 1 } };

  const root = consumer({
    [BASELINE_PATH]: baselineOf(counts),
    "src/a.ts": nonNull(1),
    "src/b.ts": STRING_SOURCE.replace("a(", "b("),
  });

  // oxlint prints its text straight to the terminal, so only the CLI's own output holds it.
  const run = await captureBun([CLI, "lint", "--all"], root);
  expect(run.code).toBe(1);
  expect(run.stdout).toContain("typescript(no-non-null-assertion)");
  expect(run.stdout).toContain("src/a.ts");
  expect(run.stdout).toMatch(/^src\/b\.ts:2:16: error repo\(magic-string\)/m);
  const gated = await captureBun([CLI, "lint"], root);
  expect(gated).toStrictEqual({
    code: 0,
    stderr: "",
    stdout: "repo lint: 2 hits within the baseline; --all prints them\n",
  });
});

it("lint with no baseline file gates against zero", { timeout: SLOW }, async () => {
  const { stdout, stderr } = spies();
  process.chdir(consumer({ "src/a.ts": nonNull(1) }));
  expect(await lintMain([])).toBe(1);
  const lines = printed(stdout, stderr);
  expect(lines).toHaveLength(2);
  expect(lines[0]).toMatch(NN_LINE);
  expect(lines[1]).toBe(`repo lint: src/a.ts has 1 ${NN}, the baseline allows 0; fix the new one\n`);
});

it("lint with a baseline that cannot be read prints why and exits 1", { timeout: SLOW }, async () => {
  const { stdout, stderr } = spies();
  process.chdir(consumer({ [BASELINE_PATH]: "[]\n", "src/a.ts": nonNull(1) }));
  expect(await lintMain([])).toBe(1);
  expect(printed(stdout, stderr)).toContain(
    `repo lint: ${BASELINE_PATH}: must be an object; fix it, or delete it and run \`bun repo lint --baseline\`\n`,
  );
});

it("lint --fix fixes, then prints only the gated report", { timeout: SLOW }, async () => {
  const root = consumer({
    [BASELINE_PATH]: baselineOf({ "src/a.ts": { [NN]: 1 } }),
    "src/a.ts": `${nonNull(1)}\nexport function greet(name: string): string {\n  return "hi " + name;\n}\n`,
  });

  const { stdout, stderr } = spies();
  process.chdir(root);
  expect(await lintMain(["--fix"])).toBe(0);
  // oxlint's fix leaves the template as it wrote it; bun fmt tidies it, lint does not.
  expect(fs.readFileSync(path.join(root, "src/a.ts"), "utf8")).toMatch(/return `hi \$\{ *name\}`;/);
  expect(printed(stdout, stderr)).toStrictEqual(["repo lint: 1 hit within the baseline; --all prints them\n"]);
});
