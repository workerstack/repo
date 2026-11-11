import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { main } from "./coverage.ts";
import type { CargoRun } from "./rust/clippy.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUN_MS = 60_000;
const FLOORS = "coverage-floors.json";
const saved = process.cwd();
const temps: string[] = [];

const SOURCE = `export function sign(n: number): string {
  if (n < 0) return "neg";
  return "pos";
}

export function unused(): number {
  return 1;
}
`;
const PASSING = `import { expect, it } from "vitest";
import { sign } from "./a.ts";

it("signs a positive number", () => {
  expect(sign(1)).toBe("pos");
});
`;
const FAILING = PASSING.replace('"pos"', '"neg"');
const SECOND_SOURCE = "export const answer = (): number => 42;\n";
const SECOND_TEST = `import { expect, it } from "vitest";
import { answer } from "./b.ts";

it("answers", () => {
  expect(answer()).toBe(42);
});
`;
/** What `SOURCE` measures with `PASSING`: lines are 2 of 3 (66.67), so the floor is 66, not 67. */
const MEASURED = { branches: 50, functions: 50, lines: 66, statements: 50 };

let out: string[] = [];
let err: string[] = [];

beforeEach(() => {
  out = [];
  err = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => out.push(String(chunk)) > 0);
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => err.push(String(chunk)) > 0);
});

afterEach(() => {
  vi.restoreAllMocks();
  process.chdir(saved);
  for (const dir of temps.splice(0)) fs.rmSync(dir, { force: true, recursive: true });
});

/** A tiny vitest project in a temp dir, with the repo's installed packages linked in; `config` is its repo config. */
function project(config = "export default {};\n"): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-coverage-")));
  temps.push(root);
  fs.symlinkSync(path.join(REPO_ROOT, "node_modules"), path.join(root, "node_modules"), "junction");
  const preset = JSON.stringify(path.join(REPO_ROOT, "presets", "vitest.ts"));
  const vitest = `import { defineConfig } from ${preset};
export default defineConfig({ test: { include: ["src/**/*.test.ts"], coverage: { include: ["src/**"] } } });
`;
  const files = {
    "src/a.test.ts": PASSING,
    "src/a.ts": SOURCE,
    "vitest.config.ts": vitest,
    "workerstack.config.ts": config,
  };
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  }
  return root;
}

function floorsOf(root: string, file = FLOORS): unknown {
  return JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
}

/** Runs `repo coverage` in `root`; `run` stands in for cargo. */
function coverage(root: string, run?: CargoRun): Promise<number> {
  process.chdir(root);
  return main([], run);
}

it("repo coverage: writes a floor for every measured file on the first run", { timeout: RUN_MS }, async () => {
  const root = project();
  expect(await coverage(root)).toBe(0);
  expect(floorsOf(root)).toStrictEqual({ "src/a.ts": MEASURED });
  const lines = ["statements new → 50", "branches new → 50", "functions new → 50", "lines new → 66"];
  expect(out.join("")).toBe(`${lines.map((line) => `src/a.ts ${line}\n`).join("")}wrote ${FLOORS}\n`);
  expect(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith("workerstack-cov-run"))).toStrictEqual([]);
});

it("repo coverage: floors every file the suite measures, sorted by path", { timeout: RUN_MS }, async () => {
  const root = project();
  fs.writeFileSync(path.join(root, "src/b.ts"), SECOND_SOURCE);
  fs.writeFileSync(path.join(root, "src/b.test.ts"), SECOND_TEST);
  expect(await coverage(root)).toBe(0);
  const written = floorsOf(root) /* the command wrote an object */ as Record<string, unknown>;
  expect(Object.keys(written)).toStrictEqual(["src/a.ts", "src/b.ts"]);
  expect(written["src/b.ts"]).toStrictEqual({ branches: 100, functions: 100, lines: 100, statements: 100 });
});

it(
  "repo coverage: prints each raised floor with its old and new value and writes the file",
  { timeout: RUN_MS },
  async () => {
    const root = project();
    fs.writeFileSync(path.join(root, FLOORS), JSON.stringify({ "src/a.ts": { ...MEASURED, branches: 40, lines: 30 } }));
    expect(await coverage(root)).toBe(0);
    expect(out.join("")).toBe(`src/a.ts branches 40 → 50\nsrc/a.ts lines 30 → 66\nwrote ${FLOORS}\n`);
    expect(floorsOf(root)).toStrictEqual({ "src/a.ts": MEASURED });
  },
);

it("repo coverage: prints only the wrote line when nothing rises", { timeout: RUN_MS }, async () => {
  const root = project();
  await coverage(root);
  out = [];
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
      expect(await coverage(project())).toBe(0);
      expect(fs.existsSync(sentinel)).toBe(true);
    } finally {
      fs.rmSync(sentinel, { force: true });
    }
  },
);

it("repo coverage: fails a drop with its line and writes nothing", { timeout: RUN_MS }, async () => {
  const root = project();
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
    const root = project();
    fs.writeFileSync(path.join(root, "src/a.test.ts"), FAILING);
    expect(await coverage(root)).toBe(1);
    expect(err.join("")).toContain("coverage: the tests failed; fix them before raising floors");
    expect(err.join("")).not.toContain("would drop");
    expect(fs.existsSync(path.join(root, FLOORS))).toBe(false);
  },
);

it("repo coverage: writes the file coverage.floors names in the config", { timeout: RUN_MS }, async () => {
  const root = project('export default { coverage: { floors: "ratchets/floors.json" } };\n');
  expect(await coverage(root)).toBe(0);
  expect(floorsOf(root, "ratchets/floors.json")).toStrictEqual({ "src/a.ts": MEASURED });
  expect(out.join("")).toContain("wrote ratchets/floors.json\n");
  expect(fs.existsSync(path.join(root, FLOORS))).toBe(false);
});

it("repo coverage: fails, saying so, when the floors file cannot be formatted", { timeout: RUN_MS }, async () => {
  const root = project('export default { coverage: { floors: "floors.txt" } };\n');
  expect(await coverage(root)).toBe(1);
  expect(err.join("")).toContain("coverage: could not format floors.txt\n");
  expect(out.join("")).toBe("");
});

it("repo coverage: fails before running anything when the repo config is invalid", async () => {
  const root = project("export default { coverage: { floor: 'a.json' } };\n");
  expect(await coverage(root)).toBe(1);
  expect(err.join("")).toBe('repo coverage: workerstack.config.ts: coverage: unknown key "floor"\n');
});

it("repo coverage: names a missing repo config", async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-coverage-")));
  temps.push(root);
  expect(await coverage(root)).toBe(1);
  expect(err.join("")).toContain("repo coverage: no workerstack.config.ts");
});

it("repo coverage: floors TypeScript and Rust files side by side", { timeout: RUN_MS }, async () => {
  const root = project();
  fs.writeFileSync(path.join(root, "Cargo.toml"), "[workspace]\nmembers = []\n");
  const row = { summary: { functions: { percent: 66.7 }, lines: { percent: 66.7 }, regions: { percent: 58.3 } } };
  const files = [{ filename: path.join(root, "a/src/lib.rs"), ...row }];
  const run: CargoRun = (_cwd, args) => {
    fs.writeFileSync(String(args.at(-1)), JSON.stringify({ data: [{ files }] }));
    return { missing: false, status: 0, stderr: "", stdout: "" };
  };
  expect(await coverage(root, run)).toBe(0);
  const rust = { functions: 66, lines: 66, regions: 58 };
  expect(floorsOf(root)).toStrictEqual({ "a/src/lib.rs": rust, "src/a.ts": MEASURED });
});

it(
  "repo coverage: a vitest project with no tests passes and floors no TypeScript file",
  { timeout: RUN_MS },
  async () => {
    const root = project();
    fs.rmSync(path.join(root, "src"), { recursive: true });
    expect(await coverage(root)).toBe(0);
    expect(floorsOf(root)).toStrictEqual({});
  },
);
