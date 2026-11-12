import { expect, it } from "vitest";

import { SAMPLES, TABLE } from "../bench/__fixtures__/usage.ts";
import type { BenchResult } from "../bench/score.ts";
import { useTempDirs } from "../sync/__fixtures__/temp-dirs.ts";
import { SHA, STARTUP, bench, ok, usageScript, type Script } from "./__fixtures__/bench-world.ts";
import { realMachine } from "./bench.ts";

useTempDirs();

const RAW = ".repo/tmp/bench/startup/ubuntu-latest.json";

/** The node candidate's script, with measured run `n` (call `n`, after the one warmup) answered by `run`. */
function nodeWith(n: number, run: ReturnType<Script>): Record<string, Script> {
  const node = usageScript(SAMPLES.node);

  return { ...STARTUP, "bun -e 2": (call) => (call === n ? run : node(call)) };
}

it("prints the Usage table and the raw path, exit 0", async () => {
  const got = await bench(["startup"]);
  expect(got).toMatchObject({ code: 0, err: "", out: `${TABLE}raw: ${RAW}\n` });
});

it("runs node's setup once, then each candidate its warmup plus 10 runs", async () => {
  const got = await bench(["startup"]);
  expect(Object.fromEntries(got.counts)).toStrictEqual({ "bun -e 0": 1, "bun -e 1": 11, "bun -e 2": 11 });
});

it("writes the raw samples of each measured run, warmup left out, with the machine and commit", async () => {
  const got = await bench(["startup"]);
  const raw = JSON.parse(got.read(RAW)) /* bench wrote a BenchResult */ as BenchResult;
  expect(raw).toMatchObject({
    env: { arch: "x64", bun: "1.3.2", dirty: true, label: "ubuntu-latest", platform: "linux" },
    runs: 10,
    spec: "startup",
    warmup: 1,
  });
  expect(raw.candidates.map((c) => c.name)).toStrictEqual(["bun", "node"]);
  expect(raw.candidates[1]?.samples.ops).toStrictEqual(SAMPLES.node.ops);
  expect(raw.candidates[1]?.samples.rss).toStrictEqual(SAMPLES.node.rss);
  expect(raw.candidates[1]?.samples.wall).toHaveLength(10);
});

it.each([
  ["linux", "x64", "ubuntu-latest"],
  ["linux", "arm64", "ubuntu-24.04-arm"],
  ["darwin", "arm64", "macos-latest"],
  ["darwin", "x64", "macos-13"],
  ["win32", "x64", "windows-latest"],
  ["freebsd", "x64", "freebsd-x64"],
])("labels a %s %s machine %s in the header", async (platform, arch, label) => {
  const got = await bench(["remote-only"], { machine: { arch, platform }, specs: ["remote-only"] });
  const machine = "AMD Ryzen 9 7950X (32) · 64 GB · bun 1.3.2";
  expect(got.out.split("\n")[0]).toBe(
    `remote-only · ${label} (${platform} ${arch}) · ${machine} · 82c0e43+dirty · 3 runs, 0 warmup`,
  );
});

it("drops +dirty from the header of a clean tree", async () => {
  const git = { "rev-parse HEAD": ok(`${SHA}\n`), "status --porcelain": ok("") };
  const got = await bench(["startup"], { git });
  expect(got.out.split("\n")[0]).toContain(" · 82c0e43 · 10 runs");
});

it("names a missing spec and the specs there are, exit 4", async () => {
  const got = await bench(["nope"], { specs: ["startup", "remote-only"] });
  expect(got).toMatchObject({
    code: 4,
    err: "repo bench: .repo/bench/nope.bench.ts not found; have: remote-only, startup\n",
    out: "",
  });
});

it("says there are no specs when .repo/bench has none, exit 4", async () => {
  const got = await bench(["nope"], { specs: [] });
  expect(got).toMatchObject({ code: 4, err: "repo bench: .repo/bench/nope.bench.ts not found; have: none\n" });
});

it("refuses a spec that does not parse, naming the file and the field, exit 4", async () => {
  const got = await bench(["bad"], { specs: ["bad"] });
  expect(got).toMatchObject({
    code: 4,
    err: "repo bench: .repo/bench/bad.bench.ts: runs: 2 is under 3; a median and CV need at least 3 runs\n",
    out: "",
  });
});

const BAD_ARGS: string[][][] = [[[]], [["a", "b"]], [["startup", "--fast"]], [["../startup"]]];

it.each(BAD_ARGS)("prints the usage for %j, exit 4", async (argv) => {
  const got = await bench(argv);
  expect(got).toMatchObject({ code: 4, err: "repo bench: usage: bun repo bench <name> [--remote]\n", out: "" });
});

it("stops on a measured run that exits non-zero, with the last 3 lines of its stderr, exit 1", async () => {
  const spawn = nodeWith(3, { code: 1, stderr: "one\ntwo\n\nthree\nfour\nfive\n" });
  const got = await bench(["startup"], { spawn });
  expect(got).toMatchObject({
    code: 1,
    err: "repo bench: node run 3 exited 1; stderr tail: three | four | five\n",
    out: "",
  });
});

it("says so when a failed run printed no stderr", async () => {
  const got = await bench(["startup"], { spawn: nodeWith(3, { code: 1 }) });
  expect(got.err).toBe("repo bench: node run 3 exited 1; no stderr\n");
});

it("names the spec file and the error of a spec that does not load, exit 4", async () => {
  const got = await bench(["broken"], { files: { ".repo/bench/broken.bench.ts": "export default {\n" }, specs: [] });
  expect(got.code).toBe(4);
  expect(got.err).toMatch(/^repo bench: \.repo\/bench\/broken\.bench\.ts: .+\n$/);
});

it("stops on a failed setup, exit 1", async () => {
  const got = await bench(["startup"], {
    spawn: { ...STARTUP, "bun -e 0": () => ({ code: 2, stderr: "no x.ts\n" }) },
  });

  expect(got).toMatchObject({ code: 1, err: "repo bench: node setup exited 2; stderr tail: no x.ts\n", out: "" });
});

it("stops on a run whose last line has no declared metric, exit 1", async () => {
  const got = await bench(["startup"], { spawn: nodeWith(2, { rss: 60, stdout: "done\n", wall: 80 }) });
  expect(got).toMatchObject({
    code: 1,
    err: 'repo bench: node run 2 printed no `bench:` line with "ops"\n',
    out: "",
  });
});

it("reads this machine's platform, arch, cores, memory and Bun version", () => {
  const machine = realMachine();
  expect(machine).toMatchObject({ arch: process.arch, bun: Bun.version, platform: process.platform });
  expect(machine.cores).toBeGreaterThan(0);
  expect(machine.memoryBytes).toBeGreaterThan(0);
});

it("flags rss near the runner's own peak and keeps that floor in the raw env", async () => {
  const got = await bench(["startup"], { machine: { rssFloorBytes: 50 * 1024 ** 2 } });
  expect(got.out).toContain("48.1 ±1%~ 47–49");
  expect(got.out).toContain("~ bun rss: 50.0 MB is this runner's own peak on linux");
  expect(got.out).not.toContain("~ node");
  const raw = JSON.parse(got.read(RAW)) /* bench wrote a BenchResult */ as BenchResult;
  expect(raw.env.rssFloorBytes).toBe(50 * 1024 ** 2);
});

it("reads this runner's peak RSS as the floor on linux and none elsewhere", () => {
  const floor = realMachine().rssFloorBytes;
  expect(floor === null).toBe(process.platform !== "linux");
  expect(floor ?? 1).toBeGreaterThan(0);
});
