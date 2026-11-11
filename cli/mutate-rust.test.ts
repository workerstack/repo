import path from "node:path";

import { expect, it } from "vitest";

import { BASE, CLONE, OUT, ROOT, SHA, at, fakes, sim, type Fakes } from "./fixtures/mutate-fakes.ts";
import { mutantsArgs } from "./mutate-rust.ts";
import { runMutate } from "./mutate.ts";
import type { CargoResult } from "./rust/clippy.ts";

const OUT_DIR = path.join(BASE, "out");
const OUTCOMES = path.join(OUT_DIR, "mutants.out", "outcomes.json");
const REPORT = at(".tmp/repo/mutation/report.json");
const PACKAGES = ["crates/a", "crates/b"];
const NO_BINARY: CargoResult = { missing: false, status: 101, stderr: "error: no such command: `mutants`", stdout: "" };

/** One outcomes.json entry, shaped as cargo-mutants 27.1.0 writes it (trimmed of phase results). */
function mutant(file: string, summary: string, line = 1) {
  const span = { end: { column: 6, line }, start: { column: 5, line } };
  const scenario = {
    Mutant: { file, genre: "FnValue", name: `${file}:${line}:5: x`, package: "p", replacement: "-", span },
  };
  return { diff_path: null, log_path: "log/x.log", phase_results: [], scenario, summary };
}

function many(file: string, summary: string, count: number) {
  return Array.from({ length: count }, (_, i) => mutant(file, summary, i + 1));
}

/** crate a: 16 caught and 7 missed (69.57%); crate b: 5 caught. */
const OUTCOMES_JSON = {
  outcomes: [
    ...many("crates/a/src/lib.rs", "CaughtMutant", 16),
    ...many("crates/a/src/lib.rs", "MissedMutant", 7),
    ...many("crates/b/src/lib.rs", "CaughtMutant", 5),
  ],
  total_mutants: 28,
};

type Script = { status?: number | null; stdout?: string; stderr?: string; outcomes?: string | null };

/** A Fakes with a Rust repo whose cargo answers `mutants --version` with 27.1.0 and runs `script`. */
function rustFakes(
  script: Script = {},
  version: CargoResult = { missing: false, status: 0, stderr: "", stdout: "cargo-mutants 27.1.0\n" },
) {
  const f: Fakes = fakes(sim(), PACKAGES);
  f.files.set(at("Cargo.toml"), "[workspace]\n");
  const outcomes = script.outcomes === undefined ? JSON.stringify(OUTCOMES_JSON) : script.outcomes;
  f.deps.cargo = (cwd, args) => {
    f.calls.push(`cargo ${args.join(" ")} @${cwd}`);
    if (args[1] === "--version") return version;
    if (outcomes !== null) f.files.set(OUTCOMES, outcomes);
    const { status = 3, stdout = "", stderr = "" } = script;
    return { missing: false, status, stderr, stdout };
  };
  return f;
}

function mutantsCall(f: Fakes): string {
  return f.calls.find((c) => c.startsWith("cargo mutants -C")) ?? "";
}

it("runs cargo mutants in a clone of HEAD, then scores each crate dir against its floor", async () => {
  const f = rustFakes();
  f.files.set(at("mutation-floors.json"), JSON.stringify({ "crates/a": 60 }));
  expect(await runMutate(["--rust"], f.deps)).toBe(0);
  expect(f.calls.filter((c) => c.startsWith("git clone") || c.startsWith("git -C"))).toStrictEqual([
    `git clone -q --shared ${ROOT} ${CLONE}`,
    `git -C ${CLONE} checkout -q --detach ${SHA}`,
  ]);
  expect(f.calls).toContain(`cargo mutants --version @${CLONE}`);
  expect(mutantsCall(f)).toBe(
    `cargo mutants -C=--locked --test-tool cargo --in-place --no-times --colors never -o ${OUT_DIR} --shard ` +
      `0/1 @${CLONE}`,
  );
  expect(f.calls.at(-1)).toBe(`rm ${BASE}`);
  expect(f.out).toStrictEqual([
    `mutate: HEAD ${SHA.slice(0, 7)}\n`,
    "mutate: cargo-mutants, 28 mutants, shard 1/1\n",
    "mutate: crates/a 69.57% (floor 60), 7 survivors in .tmp/repo/mutation/report.json\n",
    "mutate: crates/b 100.00% (no floor), 0 survivors in .tmp/repo/mutation/report.json\n",
  ]);
  const report = JSON.parse(f.files.get(REPORT) ?? "") /* the shard report this command wrote */ as {
    tool: string;
    head: string;
    files: Record<string, { killed: number; survivors: unknown[] }>;
  };
  expect(report).toMatchObject({ head: SHA, shard: { index: 1, total: 1 }, tool: "cargo-mutants" });
  expect(report.files["crates/a/src/lib.rs"]?.killed).toBe(16);
});

it("fails a crate below its floor", async () => {
  const f = rustFakes();
  f.files.set(at("mutation-floors.json"), JSON.stringify({ "crates/a": 80 }));
  expect(await runMutate(["--rust"], f.deps)).toBe(1);
  expect(f.err.join("")).toBe(
    "repo mutate: crates/a scored 69.57%, below its floor of 80 in mutation-floors.json; see the survivors " +
      "in .tmp/repo/mutation/report.json\n",
  );
});

it("turns the 1-based shard into the tool's 0-based one and skips the floors", async () => {
  const f = rustFakes();
  expect(await runMutate(["--rust", "--shard", "2/4", "--report", OUT], f.deps)).toBe(0);
  expect(mutantsCall(f)).toContain(" --shard 1/4 ");
  expect(f.out.at(-1)).toBe(`mutate: cargo-mutants, shard 2/4, 7 survivors in ${OUT}\n`);
  expect(JSON.parse(f.files.get(OUT) ?? "")).toMatchObject({ shard: { index: 2, total: 4 }, tool: "cargo-mutants" });
});

it("needs a Cargo.toml at the repo root, before any git call", async () => {
  const f = fakes(sim(), PACKAGES);
  expect(await runMutate(["--rust"], f.deps)).toBe(1);
  expect(f.err.join("")).toBe("repo mutate: --rust needs a Cargo.toml at the repo root\n");
  expect(f.calls).toStrictEqual([]);
});

it("needs no file under coverage.mutate", async () => {
  const f = rustFakes();
  f.deps.config = () => Promise.resolve({ floors: "mutation-floors.json", mutate: ["src/**/*.nothing"], root: ROOT });
  expect(await runMutate(["--rust"], f.deps)).toBe(0);
});

it("says so when cargo-mutants is missing or not the pinned version, running nothing", async () => {
  const missing = rustFakes({}, NO_BINARY);
  expect(await runMutate(["--rust"], missing.deps)).toBe(1);
  expect(missing.err.join("")).toBe(
    "repo mutate: cargo-mutants is not installed; run `cargo install --locked cargo-mutants@27.1.0`\n",
  );
  expect(mutantsCall(missing)).toBe("");
  expect(missing.calls.at(-1)).toBe(`rm ${BASE}`);
  const wrong = rustFakes({}, { missing: false, status: 0, stderr: "", stdout: "cargo-mutants 26.2.0\n" });
  expect(await runMutate(["--rust"], wrong.deps)).toBe(1);
  expect(wrong.err.join("")).toBe(
    "repo mutate: cargo-mutants 26.2.0 is installed but repo pins 27.1.0; run `cargo install --locked " +
      "cargo-mutants@27.1.0`\n",
  );
});

it.each([0, 2, 3])("reads the outcomes after exit %i", async (status) => {
  const f = rustFakes({ status });
  expect(await runMutate(["--rust", "--shard", "1/2", "--report", OUT], f.deps)).toBe(0);
  expect(f.files.has(OUT)).toBe(true);
});

it("answers exit 4 with the build-or-tests line and the tool's output", async () => {
  const f = rustFakes({ status: 4, stderr: "boom\n", stdout: "ERROR cargo test failed in an unmutated tree\n" });
  expect(await runMutate(["--rust"], f.deps)).toBe(1);
  expect(f.err.join("")).toBe(
    "repo mutate: the build or tests failed before any mutant ran; fix them first\nERROR cargo test failed " +
      "in an unmutated tree\nboom\n",
  );
  expect(f.files.has(REPORT)).toBe(false);
  expect(f.calls.at(-1)).toBe(`rm ${BASE}`);
  const quiet = rustFakes({ status: 4 });
  await runMutate(["--rust"], quiet.deps);
  expect(quiet.err.join("")).toBe("repo mutate: the build or tests failed before any mutant ran; fix them first\n");
});

it("quotes the first error line of any other exit", async () => {
  const bad = rustFakes({ status: 1, stderr: "warning: x\nerror: invalid value '2/2' for '--shard <SHARD>'\n" });
  expect(await runMutate(["--rust"], bad.deps)).toBe(1);
  expect(bad.err.join("")).toBe(
    "repo mutate: cargo mutants exited 1: error: invalid value '2/2' for '--shard <SHARD>'\n",
  );
  const plain = rustFakes({ status: 101, stdout: "\n  killed by a rule\nmore\n" });
  await runMutate(["--rust"], plain.deps);
  expect(plain.err.join("")).toBe("repo mutate: cargo mutants exited 101: killed by a rule\n");
  const signal = rustFakes({ status: null });
  await runMutate(["--rust"], signal.deps);
  expect(signal.err.join("")).toBe("repo mutate: cargo mutants exited by signal: \n");
});

it.each([
  ["missing", null, "the outcomes file is missing"],
  ["not JSON", "{", "SyntaxError"],
  ["not outcomes", '{"outcomes":3}', ""],
])("names why an outcomes file that is %s is unreadable", async (_name, outcomes, why) => {
  const f = rustFakes({ outcomes });
  expect(await runMutate(["--rust"], f.deps)).toBe(1);
  expect(f.err.join("")).toMatch(/^repo mutate: cargo-mutants wrote no readable outcomes: .+\n$/);
  expect(f.err.join("")).toContain(why);
  expect(f.files.has(REPORT)).toBe(false);
});

it("stops and removes the clone when git cannot clone", async () => {
  const f = rustFakes();
  f.deps.git = (_cwd, args) => {
    f.calls.push(`git ${args.join(" ")}`);
    return args[0] === "clone"
      ? { code: 128, stderr: "boom\n", stdout: "" }
      : { code: 0, stderr: "", stdout: `${SHA}\n` };
  };
  expect(await runMutate(["--rust"], f.deps)).toBe(1);
  expect(f.err.join("")).toBe(`repo mutate: could not clone ${ROOT}: boom\n`);
  expect(f.calls.some((c) => c.startsWith("cargo"))).toBe(false);
  expect(f.calls.at(-1)).toBe(`rm ${BASE}`);
});

it("removes the clone when cargo throws", async () => {
  const f = rustFakes();
  f.deps.cargo = () => {
    throw new Error("spawn");
  };
  await expect(runMutate(["--rust"], f.deps)).rejects.toThrow("spawn");
  expect(f.calls.at(-1)).toBe(`rm ${BASE}`);
});

it("shards by the tool's 0-based index", () => {
  const plan = { files: [], root: ROOT, sha: SHA, shard: { index: 3, total: 3 } };
  expect(mutantsArgs(plan, "o").slice(-2)).toStrictEqual(["--shard", "2/3"]);
});
