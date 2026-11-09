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
} from "./fixtures/baseline-repo.ts";
import { BASELINE_PATH } from "./lint-baseline.ts";
import { lintMain } from "./lint-main.ts";
import { captureTool } from "./lint.ts";

const saved = process.cwd();
afterEach(() => {
  process.chdir(saved);
  vi.restoreAllMocks();
  cleanTemps();
});

it(
  "lint --baseline seeds rules a file has no entry for, never raises one, drops gone files, and oxfmt keeps the file",
  { timeout: SLOW },
  async () => {
    const root = consumer({
      "src/a.ts": nonNull(2),
      "src/b.ts": `${nonNull(1, "b")}${FLOATING}`,
      "src/c.ts": nonNull(1, "c"),
      [BASELINE_PATH]: `${JSON.stringify({ "src/a.ts": { [NN]: 1 }, "src/b.ts": { [PARAMS]: 1 }, "src/gone.ts": { [NN]: 4 } })}\n`,
    });
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    process.chdir(root);
    expect(await lintMain(["--baseline"])).toBe(0);
    expect(out).toHaveBeenCalledWith("repo lint: baseline written: 3 files, 4 problems\n");
    const written = { "src/a.ts": { [NN]: 1 }, "src/b.ts": { [FLOAT]: 1, [NN]: 1 }, "src/c.ts": { [NN]: 1 } };
    expect(fs.readFileSync(path.join(root, BASELINE_PATH), "utf8")).toBe(`${JSON.stringify(written, null, 2)}\n`);
    expect(captureTool("oxfmt", ["--check", BASELINE_PATH], root).code).toBe(0);
  },
);

it("lint --baseline refuses other arguments, and lint without it is plain oxlint", async () => {
  const root = consumer({ "src/a.ts": "export const a = 1;\n" });
  const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  process.chdir(root);
  expect(await lintMain(["--baseline", "src"])).toBe(1);
  expect(err).toHaveBeenCalledWith("repo lint: --baseline takes no other arguments; it lints the whole repo\n");
  expect(fs.existsSync(path.join(root, BASELINE_PATH))).toBe(false);
  expect(await lintMain(["src"])).toBe(0);
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

it("lint --baseline refuses a broken baseline and leaves it", async () => {
  const root = consumer({ [BASELINE_PATH]: "[]\n" });
  const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  process.chdir(root);
  expect(await lintMain(["--baseline"])).toBe(1);
  expect(err).toHaveBeenCalledWith(
    `repo lint: ${BASELINE_PATH}: must be an object; fix it, or delete it and run \`bun repo lint --baseline\`\n`,
  );
  expect(fs.readFileSync(path.join(root, BASELINE_PATH), "utf8")).toBe("[]\n");
});

it("lint --baseline seeds the repo's magic hits, and none a lint.skip turns off", { timeout: SLOW }, async () => {
  const root = consumer({ "src/wait.ts": WAIT, "src/b.ts": WAIT.replace("wait", "b") });
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  process.chdir(root);
  expect(await lintMain(["--baseline"])).toBe(0);
  const baseline = () => JSON.parse(fs.readFileSync(path.join(root, BASELINE_PATH), "utf8")) as unknown;
  expect(baseline()).toEqual({ "src/wait.ts": { [MAGIC]: 1 }, "src/b.ts": { [MAGIC]: 1 } });
  const skip = { files: ["src/wait.ts"], rules: ["repo/magic-number"], reason: "retry tuning lives here" };
  fs.writeFileSync(
    path.join(root, "workerstack.config.ts"),
    `export default ${JSON.stringify({ packs: ["standards"], lint: { skip: [skip] } })};\n`,
  );
  fs.rmSync(path.join(root, BASELINE_PATH));
  expect(await lintMain(["--baseline"])).toBe(0);
  expect(baseline()).toEqual({ "src/b.ts": { [MAGIC]: 1 } });
});

it("lint --baseline reports why the magic check could not run and writes nothing", async () => {
  const root = consumer({ "pkg/tsconfig.json": "{", "pkg/wait.ts": WAIT });
  const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  process.chdir(root);
  expect(await lintMain(["--baseline"])).toBe(1);
  expect(err).toHaveBeenCalledWith(expect.stringMatching(/^repo lint: pkg\/tsconfig\.json: .+\n$/));
  expect(fs.existsSync(path.join(root, BASELINE_PATH))).toBe(false);
});

it("lint --baseline seeds the repo's untested guards beside its magic hits", { timeout: SLOW }, async () => {
  const guard = "export const isUser = (value: unknown): value is string[] => Array.isArray(value);\n";
  const root = consumer({ "src/is-user.ts": guard, "src/wait.ts": WAIT });
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  process.chdir(root);
  expect(await lintMain(["--baseline"])).toBe(0);
  const baseline = JSON.parse(fs.readFileSync(path.join(root, BASELINE_PATH), "utf8")) as unknown;
  expect(baseline).toEqual({ "src/is-user.ts": { "repo(guard-rejects)": 1 }, "src/wait.ts": { [MAGIC]: 1 } });
});
