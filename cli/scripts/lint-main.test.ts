import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import {
  cleanTemps,
  consumer,
  FLOAT,
  FLOATING,
  MAGIC,
  NN,
  nonNull,
  PARAMS,
  SLOW,
  WAIT,
} from "./__fixtures__/baseline-repo.ts";
import {
  GUARD_HIT,
  GUARD_SOURCE,
  GUARD_TEST,
  planted,
  skipIn,
  spies,
  STRING_HIT,
} from "./__fixtures__/lint-scripts-kit.ts";
import { BASELINE_PATH } from "./lint-baseline.constants.ts";
import { lintMain } from "./lint-main.ts";
import { captureTool } from "./lint.ts";

const saved = process.cwd();

afterEach(() => {
  process.chdir(saved);
  vi.restoreAllMocks();
  cleanTemps();
});

it(
  "lint --baseline seeds rules a file has no entry for, never raises one, drops gone files, and bun fmt keeps the file",
  { timeout: SLOW },
  async () => {
    const seeded = { "src/a.ts": { [NN]: 1 }, "src/b.ts": { [PARAMS]: 1 }, "src/gone.ts": { [NN]: 4 } };

    const root = consumer({
      [BASELINE_PATH]: `${JSON.stringify(seeded)}\n`,
      "src/a.ts": nonNull(2),
      "src/b.ts": `${nonNull(1, "b")}\n${FLOATING}`,
      "src/c.ts": nonNull(1, "c"),
    });

    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    process.chdir(root);
    expect(await lintMain(["--baseline"])).toBe(0);
    expect(out).toHaveBeenCalledWith("repo lint: baseline written: 3 files, 4 problems\n");
    const written = { "src/a.ts": { [NN]: 1 }, "src/b.ts": { [FLOAT]: 1, [NN]: 1 }, "src/c.ts": { [NN]: 1 } };
    expect(fs.readFileSync(path.join(root, BASELINE_PATH), "utf8")).toBe(`${JSON.stringify(written, null, 2)}\n`);
    expect(captureTool("bun fmt", ["--check", BASELINE_PATH], root).code).toBe(0);
  },
);

it("lint --baseline refuses other arguments", async () => {
  const root = consumer({ "src/a.ts": "export const a = 1;\n" });
  const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  process.chdir(root);
  expect(await lintMain(["--baseline", "src"])).toBe(1);
  expect(err).toHaveBeenCalledWith("repo lint: --baseline takes no other arguments; it lints the whole repo\n");
  expect(fs.existsSync(path.join(root, BASELINE_PATH))).toBe(false);
});

it("lint --baseline stops at the standards pack refusal and writes nothing", async () => {
  const root = consumer({}, '["docs"]');
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  process.chdir(root);
  expect(await lintMain(["--baseline"])).toBe(1);
  expect(fs.existsSync(path.join(root, BASELINE_PATH))).toBe(false);
});

it("lint --baseline counts one file and one problem in the singular", { timeout: SLOW }, async () => {
  const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  process.chdir(consumer({ "src/a.ts": nonNull(1) }));
  expect(await lintMain(["--baseline"])).toBe(0);
  expect(out).toHaveBeenCalledWith("repo lint: baseline written: 1 file, 1 problem\n");
});

/** Runs `lint --baseline` in `root`, expecting it to fail; the spy on what it wrote to stderr. */
async function failingBaseline(root: string) {
  const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  process.chdir(root);
  expect(await lintMain(["--baseline"])).toBe(1);

  return err;
}

it("lint --baseline refuses a broken baseline and leaves it", async () => {
  const root = consumer({ [BASELINE_PATH]: "[]\n" });
  const err = await failingBaseline(root);
  expect(err).toHaveBeenCalledWith(
    `repo lint: ${BASELINE_PATH}: must be an object; fix it, or delete it and run \`bun repo lint --baseline\`\n`,
  );
  expect(fs.readFileSync(path.join(root, BASELINE_PATH), "utf8")).toBe("[]\n");
});

it("lint --baseline seeds the repo's magic hits, and none a lint.skip turns off", { timeout: SLOW }, async () => {
  const root = consumer({ "src/b.ts": WAIT.replace("wait", "b"), "src/wait.ts": WAIT });
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  process.chdir(root);
  expect(await lintMain(["--baseline"])).toBe(0);

  function baseline() {
    return JSON.parse(fs.readFileSync(path.join(root, BASELINE_PATH), "utf8"));
  }

  expect(baseline()).toStrictEqual({ "src/b.ts": { [MAGIC]: 1 }, "src/wait.ts": { [MAGIC]: 1 } });
  const skip = { files: ["src/wait.ts"], reason: "retry tuning lives here", rules: ["repo/magic-number"] };
  fs.writeFileSync(
    path.join(root, "workerstack.config.ts"),
    `export default ${JSON.stringify({ lint: { skip: [skip] }, packs: ["standards"] }, null, 2)};\n`,
  );
  fs.rmSync(path.join(root, BASELINE_PATH));
  expect(await lintMain(["--baseline"])).toBe(0);
  expect(baseline()).toStrictEqual({ "src/b.ts": { [MAGIC]: 1 } });
});

it("lint --baseline reports why the magic check could not run and writes nothing", async () => {
  const root = consumer({ "pkg/tsconfig.json": "{", "pkg/wait.ts": WAIT });
  const err = await failingBaseline(root);
  expect(err).toHaveBeenCalledWith(expect.stringMatching(/^repo lint: pkg\/tsconfig\.json: .+\n$/));
  expect(fs.existsSync(path.join(root, BASELINE_PATH))).toBe(false);
});

it("lint --baseline seeds the repo's untested guards beside its magic hits", { timeout: SLOW }, async () => {
  const root = consumer({ "src/is-user.ts": GUARD_SOURCE, "src/wait.ts": WAIT });
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  process.chdir(root);
  expect(await lintMain(["--baseline"])).toBe(0);
  const baseline = JSON.parse(fs.readFileSync(path.join(root, BASELINE_PATH), "utf8"));
  expect(baseline).toStrictEqual({ "src/is-user.ts": { "repo(guard-rejects)": 1 }, "src/wait.ts": { [MAGIC]: 1 } });
});

it("lint prints the script hits of the paths given, after oxlint, and fails on one", { timeout: SLOW }, async () => {
  const { stdout, clear } = spies();
  process.chdir(planted());
  expect(await lintMain(["src/a.ts"])).toBe(1);
  expect(stdout()).toStrictEqual([`${STRING_HIT}\n`]);
  clear();
  expect(await lintMain(["src/b.ts"])).toBe(0);
  expect(stdout()).toStrictEqual([]);
  clear();
  expect(await lintMain(["src"])).toBe(1);
  expect(stdout()).toStrictEqual([`${STRING_HIT}\n`]);
  clear();
  expect(await lintMain([])).toBe(1);
  expect(stdout()).toStrictEqual([`${STRING_HIT}\n`]);
});

it("lint leaves a hit out that a lint.skip turns off", { timeout: SLOW }, async () => {
  const root = planted();
  const { stdout } = spies();
  process.chdir(root);
  expect(await lintMain(["src/a.ts"])).toBe(1);
  skipIn(root, "src/a.ts", "repo/magic-string");
  expect(await lintMain(["src/a.ts"])).toBe(0);
  expect(stdout()).toStrictEqual([`${STRING_HIT}\n`]);
});

it("lint names an unreadable tsconfig on stderr and fails", { timeout: SLOW }, async () => {
  const { stderr } = spies();
  process.chdir(consumer({ "pkg/tsconfig.json": "{", "pkg/wait.ts": WAIT }));
  expect(await lintMain(["pkg/wait.ts"])).toBe(1);
  expect(stderr()).toStrictEqual([expect.stringMatching(/^repo lint: pkg\/tsconfig\.json: .+\n$/)]);
});

it("lint keeps a skipped guard of an imported source out, and prints it unskipped", { timeout: SLOW }, async () => {
  const root = consumer({
    "src/is-user.test.ts": GUARD_TEST,
    "src/is-user.ts": GUARD_SOURCE,
  });

  const { stdout, clear } = spies();
  process.chdir(root);
  expect(await lintMain(["src/is-user.test.ts"])).toBe(1);
  expect(stdout()).toStrictEqual([`${GUARD_HIT}\n`]);
  clear();
  skipIn(root, "src/is-user.ts", "repo/guard-rejects");
  expect(await lintMain(["src/is-user.test.ts"])).toBe(0);
  expect(stdout()).toStrictEqual([]);
});

it("lint takes only existing files as paths, and none of a machine format's", { timeout: SLOW }, async () => {
  const { stdout, clear } = spies();
  process.chdir(planted());
  expect(await lintMain(["--max-warnings", "0", "src/a.ts"])).toBe(1);
  expect(stdout()).toStrictEqual([`${STRING_HIT}\n`]);
  clear();
  expect(await lintMain(["--max-warnings", "0", "src/b.ts"])).toBe(0);
  expect(stdout()).toStrictEqual([]);
  expect(await lintMain(["--format", "json", "src/a.ts"])).toBe(0);
  expect(stdout()).toStrictEqual([]);
  expect(await lintMain(["-f", "json", "src/a.ts"])).toBe(0);
  expect(stdout()).toStrictEqual([]);
  expect(await lintMain(["--format=json", "src/a.ts"])).toBe(0);
  expect(stdout()).toStrictEqual([]);
  expect(await lintMain(["--format=default", "src/a.ts"])).toBe(1);
  expect(stdout()).toStrictEqual([`${STRING_HIT}\n`]);
  clear();
  expect(await lintMain(["--format", "default", "src/a.ts"])).toBe(1);
  expect(stdout()).toStrictEqual([`${STRING_HIT}\n`]);
});
