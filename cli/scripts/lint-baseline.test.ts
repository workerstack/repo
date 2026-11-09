import fs from "node:fs";
import { DEFAULT_COMMIT } from "../config.ts";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { standards } from "../sync/standards.ts";
import { BASELINE_PATH, checkLintBaseline, excessText, gate, lintMain } from "./lint-baseline.ts";
import { captureTool } from "./lint.ts";

const SLOW = 60_000;
const NN = "typescript(no-non-null-assertion)";
const FLOAT = "typescript(no-floating-promises)";
const PARAMS = "eslint(max-params)";

const temps: string[] = [];
const saved = process.cwd();
afterEach(() => {
  process.chdir(saved);
  vi.restoreAllMocks();
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** `count` functions, each with one non-null assertion, the first named after the file `<stem>.ts` they go in. */
const nonNull = (count: number, stem = "a") =>
  Array.from(
    { length: count },
    (_, i) => `export const ${stem}${i === 0 ? "" : i} = (xs: string[]): string => xs.find(Boolean)!;\n`,
  ).join("");
const FLOATING = "export function start(load: () => Promise<void>): void {\n  load();\n}\n";

/** A consumer root with `packs`, the two tool configs as sync writes them, and `files`. */
function consumer(files: Record<string, string>, packs = '["standards"]'): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-baseline-")));
  temps.push(root);
  const ctx = {
    root: "",
    config: { packs: ["standards" as const], agents: { hosts: [], skills: [] }, commit: DEFAULT_COMMIT },
    workspace: { root: "", manifest: {}, packages: [] },
    read: () => null,
  };
  const configs = standards(ctx, []).outputs.map((output): [string, string] => [
    output.path,
    output.kind === "file" ? output.content : "",
  ]);
  const all = {
    ...Object.fromEntries(configs),
    "package.json": '{ "name": "app", "type": "module" }\n',
    "workerstack.config.ts": `export default { packs: ${packs} };\n`,
    ...files,
  };
  for (const [rel, text] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}

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
    expect(await checkLintBaseline(root)).toEqual([
      `${BASELINE_PATH}: src/a.ts has 2 ${NN}, the baseline allows 1`,
      `${BASELINE_PATH}: src/b.ts has 1 ${NN}, the baseline allows 3; run \`bun repo lint --baseline\` to lower it`,
      `${BASELINE_PATH}: src/gone.ts is gone; run \`bun repo lint --baseline\``,
    ]);
    fs.writeFileSync(path.join(root, "src/a.ts"), nonNull(1));
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    process.chdir(root);
    expect(await lintMain(["--baseline"])).toBe(0);
    expect(await checkLintBaseline(root)).toEqual([]);
  },
);

it("lint --baseline counts one file and one problem in the singular", { timeout: SLOW }, async () => {
  const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  process.chdir(consumer({ "src/a.ts": nonNull(1) }));
  expect(await lintMain(["--baseline"])).toBe(0);
  expect(out).toHaveBeenCalledWith("repo lint: baseline written: 1 file, 1 problem\n");
});

it("the check holds a repo with no baseline file to zero problems", { timeout: SLOW }, async () => {
  expect(await checkLintBaseline(consumer({ "src/a.ts": nonNull(1) }))).toEqual([
    `${BASELINE_PATH}: src/a.ts has 1 ${NN}, the baseline allows 0`,
  ]);
  expect(await checkLintBaseline(consumer({ "src/a.ts": "export const a = 1;\n" }))).toEqual([]);
});

it("the check skips a repo with the standards pack off or no config, and reports a broken baseline", async () => {
  expect(await checkLintBaseline(consumer({ "src/a.ts": nonNull(1) }, '["docs"]'))).toEqual([]);
  expect(await checkLintBaseline(os.tmpdir())).toEqual([]);
  const unsynced = consumer({ "src/a.ts": nonNull(1) });
  fs.rmSync(path.join(unsynced, ".oxlintrc.json"));
  expect(await checkLintBaseline(unsynced)).toEqual([]);
  const broken = consumer({ [BASELINE_PATH]: '{ "src/a.ts": { "x": -1 } }\n' });
  expect(await checkLintBaseline(broken)).toEqual([
    `${BASELINE_PATH}: src/a.ts: x: must be a whole number above 0; fix it, or delete it and run \`bun repo lint --baseline\``,
  ]);
  fs.writeFileSync(path.join(broken, BASELINE_PATH), "{");
  expect((await checkLintBaseline(broken))[0]).toMatch(
    new RegExp(`^${BASELINE_PATH.replace(".", "\\.")}: not valid JSON`),
  );
});

it(
  "counts a file oxlint cannot parse as parse-error, and reports an oxlint that fails",
  { timeout: SLOW },
  async () => {
    const root = consumer({ "src/a.ts": "export const = ;\n" });
    expect(await checkLintBaseline(root)).toEqual([
      `${BASELINE_PATH}: src/a.ts has 1 parse-error, the baseline allows 0`,
    ]);
    fs.writeFileSync(path.join(root, ".oxlintrc.json"), "{");
    expect((await checkLintBaseline(root))[0]).toMatch(/^oxlint exited 1: Failed to parse oxlint configuration file/);
  },
);

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
