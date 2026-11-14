import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it, vi } from "vitest";

import { useCapturedRun } from "./__fixtures__/captured-run.ts";
import {
  coverage,
  FLOORS,
  floorsOf,
  MEASURED,
  PASSING,
  project,
  REPO_ROOT,
  RUN_MS,
} from "./__fixtures__/coverage-project.ts";
import { removeTree } from "./remove-tree.ts";
import type { CargoRun } from "./rust/clippy.ts";

const { err, out, temps } = useCapturedRun();

const FAILING = PASSING.replace('"pos"', '"neg"');
const SECOND_SOURCE = "export const answer = (): number => 42;\n";

const SECOND_TEST = `import { expect, it } from "vitest";
import { answer } from "./b.ts";

it("answers", () => {
  expect(answer()).toBe(42);
});
`;

it("repo coverage: writes a floor for every measured file on the first run", { timeout: RUN_MS }, async () => {
  // A temp dir of its own: other files' runs share the run's temp root, so their measuring dirs show up there.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-coverage-tmp-"));
  temps.push(tmp);

  for (const name of ["TMPDIR", "TEMP", "TMP"]) vi.stubEnv(name, tmp);
  const root = project(temps);
  expect(await coverage(root)).toBe(0);
  expect(floorsOf(root)).toStrictEqual({ "src/a.ts": MEASURED });
  const lines = ["statements new → 50", "branches new → 50", "functions new → 50", "lines new → 66"];
  expect(out.join("")).toBe(`${lines.map((line) => `src/a.ts ${line}\n`).join("")}wrote ${FLOORS}\n`);
  expect(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith("workerstack-cov-run"))).toStrictEqual([]);
});

it("repo coverage: floors every file the suite measures, sorted by path", { timeout: RUN_MS }, async () => {
  const root = project(temps);
  fs.writeFileSync(path.join(root, "src/b.ts"), SECOND_SOURCE);
  fs.writeFileSync(path.join(root, "src/b.test.ts"), SECOND_TEST);
  expect(await coverage(root)).toBe(0);
  const written = floorsOf(root);
  expect(Object.keys(written)).toStrictEqual(["src/a.ts", "src/b.ts"]);
  expect(written["src/b.ts"]).toStrictEqual({ branches: 100, functions: 100, lines: 100, statements: 100 });
});

it(
  "repo coverage: prints each raised floor with its old and new value and writes the file",
  { timeout: RUN_MS },
  async () => {
    const root = project(temps);
    fs.writeFileSync(path.join(root, FLOORS), JSON.stringify({ "src/a.ts": { ...MEASURED, branches: 40, lines: 30 } }));
    expect(await coverage(root)).toBe(0);
    expect(out.join("")).toBe(`src/a.ts branches 40 → 50\nsrc/a.ts lines 30 → 66\nwrote ${FLOORS}\n`);
    expect(floorsOf(root)).toStrictEqual({ "src/a.ts": MEASURED });
  },
);

it("repo coverage: prints only the wrote line when nothing rises", { timeout: RUN_MS }, async () => {
  const root = project(temps);
  await coverage(root);
  out.length = 0;
  expect(await coverage(root)).toBe(0);
  expect(out.join("")).toBe(`wrote ${FLOORS}\n`);
});

// A project that links this checkout's packages shares their vitest module cache; a nested run that resets it
// (its lockfile differs) deletes entries the outer run is still reading.
it(
  "repo coverage: leaves the module cache it shares through the linked packages alone",
  { timeout: RUN_MS },
  async () => {
    const cache = path.join(REPO_ROOT, "node_modules", ".vitest-cache");
    fs.mkdirSync(cache, { recursive: true });
    const sentinel = path.join(cache, `sentinel-${process.pid}`);
    fs.writeFileSync(sentinel, "");

    try {
      expect(await coverage(project(temps))).toBe(0);
      expect(fs.existsSync(sentinel)).toBe(true);
    } finally {
      fs.rmSync(sentinel, { force: true });
    }
  },
);

it("repo coverage: fails a drop with its line and writes nothing", { timeout: RUN_MS }, async () => {
  const root = project(temps);
  const floors = JSON.stringify({ "src/a.ts": { ...MEASURED, branches: 100, lines: 75 } });
  fs.writeFileSync(path.join(root, FLOORS), floors);
  expect(await coverage(root)).toBe(1);
  const keep = "restore the tests or keep the floor";
  expect(err.join("")).toContain(`coverage: src/a.ts branches would drop 100 → 50; ${keep}\n`);
  expect(err.join("")).toContain(`coverage: src/a.ts lines would drop 75 → 66; ${keep}\n`);
  expect(out.join("")).toBe("");
  expect(fs.readFileSync(path.join(root, FLOORS), "utf8")).toBe(floors);
});

it(
  "repo coverage: fails a failing test as a test, not as a drop, and writes nothing",
  { timeout: RUN_MS },
  async () => {
    const root = project(temps);
    fs.writeFileSync(path.join(root, "src/a.test.ts"), FAILING);
    expect(await coverage(root)).toBe(1);
    expect(err.join("")).toContain("coverage: the tests failed; fix them before raising floors");
    expect(err.join("")).not.toContain("would drop");
    expect(fs.existsSync(path.join(root, FLOORS))).toBe(false);
  },
);

it("repo coverage: writes the file coverage.floors names in the config", { timeout: RUN_MS }, async () => {
  const root = project(temps, 'export default { coverage: { floors: "ratchets/floors.json" } };\n');
  expect(await coverage(root)).toBe(0);
  expect(floorsOf(root, "ratchets/floors.json")).toStrictEqual({ "src/a.ts": MEASURED });
  expect(out.join("")).toContain("wrote ratchets/floors.json\n");
  expect(fs.existsSync(path.join(root, FLOORS))).toBe(false);
});

it("repo coverage: fails, saying so, when the floors file cannot be formatted", { timeout: RUN_MS }, async () => {
  const root = project(temps, 'export default { coverage: { floors: "floors.txt" } };\n');
  expect(await coverage(root)).toBe(1);
  expect(err.join("")).toContain("coverage: could not format floors.txt\n");
  expect(out.join("")).toBe("");
});

it("repo coverage: fails before running anything when the repo config is invalid", async () => {
  const root = project(temps, "export default { coverage: { floor: 'a.json' } };\n");
  expect(await coverage(root)).toBe(1);
  expect(err.join("")).toBe('repo coverage: repo.config.ts: coverage: unknown key "floor"\n');
});

it("repo coverage: names a missing repo config", async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-coverage-")));
  temps.push(root);
  expect(await coverage(root)).toBe(1);
  expect(err.join("")).toContain("repo coverage: no repo.config.ts");
});

it("repo coverage: floors TypeScript and Rust files side by side", { timeout: RUN_MS }, async () => {
  const root = project(temps);
  fs.writeFileSync(path.join(root, "Cargo.toml"), "[workspace]\nmembers = []\n");
  const row = { summary: { functions: { percent: 66.7 }, lines: { percent: 66.7 }, regions: { percent: 58.3 } } };
  const files = [{ filename: path.join(root, "a/src/lib.rs"), ...row }];

  function run(_cwd: string, args: readonly string[]): ReturnType<CargoRun> {
    fs.writeFileSync(String(args.at(-1)), JSON.stringify({ data: [{ files }] }));

    return { missing: false, status: 0, stderr: "", stdout: "" };
  }

  expect(await coverage(root, run)).toBe(0);
  const rust = { functions: 66, lines: 66, regions: 58 };
  expect(floorsOf(root)).toStrictEqual({ "a/src/lib.rs": rust, "src/a.ts": MEASURED });
});

it(
  "repo coverage: a vitest project with no tests passes and floors no TypeScript file",
  { timeout: RUN_MS },
  async () => {
    const root = project(temps);
    removeTree(path.join(root, "src"));
    expect(await coverage(root)).toBe(0);
    expect(floorsOf(root)).toStrictEqual({});
  },
);
