import { expect, it } from "vitest";

import { ROWS } from "../bench/__fixtures__/usage.ts";
import { useTempDirs } from "../sync/__fixtures__/temp-dirs.ts";
import { BENCH_YML, GH, MAC, WIN, remote, view } from "./__fixtures__/bench-remote-world.ts";
import { REMOTE_GIT, RUN_URL, SHA, bad, bench, ok, rawOn } from "./__fixtures__/bench-world.ts";

useTempDirs();
const DISPATCH = [
  "gh workflow run bench.yml --ref feat -f spec=startup",
  '-f os=["macos-latest","windows-latest"]',
  `-f sha=${SHA}`,
].join(" ");

function header(label: string, machine: string) {
  return `startup · ${label} · ${machine} · bun 1.4.4 · 82c0e43 · 10 runs, 1 warmup`;
}

it("prints the local table, the dispatched line, then one table per OS with its raw path, exit 0", async () => {
  const got = await remote();
  const local = header("ubuntu-latest (linux x64)", "AMD Ryzen 9 7950X (32) · 64 GB").replace("1.4.4", "1.3.2");
  expect(got).toMatchObject({ code: 0, err: "" });
  expect(got.out).toBe(
    [
      local,
      ROWS,
      "raw: .repo/tmp/bench/startup/ubuntu-latest.json",
      `repo bench: dispatched bench.yml at 82c0e43 for macos-latest, windows-latest: ${RUN_URL}`,
      header("macos-latest (darwin arm64)", "Apple M1 (3) · 7 GB"),
      ROWS,
      "raw: .repo/tmp/bench/startup/macos-latest.json",
      header("windows-latest (win32 x64)", "AMD EPYC 7763 (4) · 16 GB"),
      ROWS,
      "raw: .repo/tmp/bench/startup/windows-latest.json",
      "",
    ].join("\n"),
  );
});

it("dispatches bench.yml on HEAD's branch with the spec, the other OSes as JSON and HEAD's sha", async () => {
  const got = await remote();
  expect(got.calls.filter((call) => call.startsWith("gh workflow run"))).toStrictEqual([DISPATCH]);
});

it("downloads the run picked by HEAD's sha and the workflow_dispatch event, and keeps each OS's raw file", async () => {
  const got = await remote();
  expect(got.calls.some((call) => call.startsWith("gh run download 123 "))).toBe(true);
  expect(JSON.parse(got.read(".repo/tmp/bench/startup/windows-latest.json"))).toMatchObject({
    env: { label: "windows-latest" },
  });
});

it("runs nothing locally when the local label is not in the spec's os", async () => {
  const wall = { better: "lower", name: "wall", unit: "ms", weight: 1 };
  const raw = { ...rawOn(MAC), metrics: [wall], runs: 3, spec: "remote-only", warmup: 0 };
  const artifacts = { "macos-latest": { ...raw, candidates: [{ name: "bun", samples: { wall: [1, 2, 3] } }] } };
  const got = await bench(["remote-only", "--remote"], {
    artifacts,
    files: BENCH_YML,
    gh: GH,
    git: REMOTE_GIT,
    specs: ["remote-only"],
  });
  expect(got.code).toBe(0);
  expect(got.counts.size).toBe(0);
  expect(got.calls).toContain(
    `gh workflow run bench.yml --ref feat -f spec=remote-only -f os=["macos-latest"] -f sha=${SHA}`,
  );
  expect(got.out.split("\n").slice(0, 2)).toStrictEqual([
    `repo bench: dispatched bench.yml at 82c0e43 for macos-latest: ${RUN_URL}`,
    header("macos-latest (darwin arm64)", "Apple M1 (3) · 7 GB")
      .replace("startup", "remote-only")
      .replace("10 runs, 1 warmup", "3 runs, 0 warmup"),
  ]);
});

it("names the OS of a failed run and links it, exit 1", async () => {
  const failed = view("completed", "failure", [
    ["bench (macos-latest)", "success"],
    ["bench (windows-latest)", "failure"],
  ]);
  const got = await remote({ gh: { ...GH, "run view 123": [failed] } });
  expect(got.code).toBe(1);
  expect(got.err).toBe(`repo bench: run 123 failed (windows-latest); see ${RUN_URL}\n`);
});

it.each([
  [
    "no bench.yml",
    { files: {} },
    "repo bench: --remote needs .github/workflows/bench.yml; " +
      'add "benchmark" to packs in workerstack.config.ts and run bun repo sync',
  ],
  [
    "bench.yml not on origin/main",
    { git: { ...REMOTE_GIT, "cat-file -e origin/main:.github/workflows/bench.yml": bad("fatal") } },
    "repo bench: GitHub dispatches bench.yml only from origin/main; land it there first (bun repo push)",
  ],
  [
    "HEAD not on origin",
    { git: { ...REMOTE_GIT, "rev-parse --verify --quiet refs/remotes/origin/feat": ok(`${"e".repeat(40)}\n`) } },
    "repo bench: origin does not have HEAD 82c0e43; run bun repo push first",
  ],
  [
    "a dirty tree",
    { git: { ...REMOTE_GIT, "status --porcelain": ok(" M cli/x.ts\n") } },
    "repo bench: --remote measures HEAD; commit or drop the changes first",
  ],
])("refuses %s with one line, runs and dispatches nothing, exit 4", async (_, change, line) => {
  const got = await remote(change);
  expect(got).toMatchObject({ code: 4, err: `${line}\n`, out: "" });
  expect(got.calls.filter((call) => call.startsWith("gh workflow run"))).toStrictEqual([]);
  expect(got.counts.size).toBe(0);
});

it("reads a runner's rss floor from its artifact and flags it, and an artifact without one as no floor", async () => {
  const artifacts = { "macos-latest": rawOn({ ...MAC, rssFloorBytes: 50 * 1024 ** 2 }), "windows-latest": rawOn(WIN) };
  const got = await remote({ artifacts });
  expect(got.code).toBe(0);
  const flagged = got.out.split("\n").filter((line) => line.startsWith("~ "));
  expect(flagged).toStrictEqual([
    "~ bun rss: 50.0 MB is this runner's own peak on linux, which a child's count starts from; " +
      "its real peak is at most that",
  ]);
  expect(JSON.parse(got.read(".repo/tmp/bench/startup/macos-latest.json"))).toMatchObject({
    env: { rssFloorBytes: 50 * 1024 ** 2 },
  });
});
