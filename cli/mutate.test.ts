import path from "node:path";

import { expect, it } from "vitest";

import { BASE, CLONE, OUT, ROOT, SHA, fakes, rawReport, sim } from "./__fixtures__/mutate-fakes.ts";
import { runMutate } from "./mutate.ts";

const SHARD = ["--shard", "1/2", "--report", OUT];
const INSTALL =
  "repo mutate: install the mutation tool first: bun add -d @stryker-mutator/core@10.1.1 " +
  "@stryker-mutator/vitest-runner@10.1.1\n";

it("clones HEAD shared, detaches to its sha, installs frozen, runs Stryker there and removes the clone", async () => {
  const f = fakes();
  expect(await runMutate(SHARD, f.deps)).toBe(0);
  const git = f.calls.filter((c) => c.startsWith("git"));
  expect(git).toStrictEqual([
    "git rev-parse HEAD",
    "git status --porcelain",
    "git ls-tree -r --name-only HEAD",
    `git clone -q --shared ${ROOT} ${CLONE}`,
    `git -C ${CLONE} checkout -q --detach ${SHA}`,
  ]);
  const order = f.calls.map((c) => c.split(" ")[0] + (c.includes("install") ? " install" : ""));
  expect(order.slice(-3)).toStrictEqual(["bun install", "bun", "rm"]);
  expect(f.calls).toContain(`bun install --frozen-lockfile @${CLONE}`);
  expect(f.calls.at(-1)).toBe(`rm ${BASE}`);
  expect(f.calls.filter((c) => c.startsWith("mkdtemp"))).toStrictEqual(["mkdtemp workerstack-mutate-"]);
});

it("runs the bin the clone's package names under bun with the preload, config outside the clone", async () => {
  const f = fakes();
  await runMutate(SHARD, f.deps);
  const run = f.calls.find((c) => c.includes("stryker.js"));
  const bin = path.join(CLONE, "node_modules/@stryker-mutator/core/bin/stryker.js");
  expect(run).toBe(
    `bun --bun --preload /pkg/cli/stryker-preload.ts ${bin} run ${path.join(BASE, "stryker.json")} @${CLONE}`,
  );
});

it("writes a Stryker config with the shard's files and the options this repo needs", async () => {
  const f = fakes();
  let config: unknown;
  const write = f.deps.fs.write;
  f.deps.fs.write = (file, text) => {
    if (file.endsWith("stryker.json")) config = JSON.parse(text);
    write(file, text);
  };
  await runMutate(SHARD, f.deps);
  expect(config).toStrictEqual({
    coverageAnalysis: "perTest",
    disableTypeChecks: false,
    ignoreStatic: true,
    inPlace: true,
    jsonReporter: { fileName: path.join(BASE, "stryker-report.json") },
    mutate: ["src/a.ts"],
    reporters: ["json"],
    testRunner: "vitest",
    vitest: { pool: "forks" },
  });
});

it("removes the clone when Stryker fails, when git fails and when a step throws", async () => {
  const failed = fakes(sim({ stryker: { code: 1, output: "x", report: {} } }));
  expect(await runMutate(SHARD, failed.deps)).toBe(1);
  expect(failed.calls.at(-1)).toBe(`rm ${BASE}`);
  const cloneFails = fakes(sim({ gitFails: "clone" }));
  expect(await runMutate(SHARD, cloneFails.deps)).toBe(1);
  expect(cloneFails.err.join("")).toBe(`repo mutate: could not clone ${ROOT}: boom\n`);
  expect(cloneFails.calls.at(-1)).toBe(`rm ${BASE}`);
  const thrown = fakes();
  thrown.deps.run = () => {
    throw new Error("spawn died");
  };
  await expect(runMutate(SHARD, thrown.deps)).rejects.toThrow("spawn died");
  expect(thrown.calls.at(-1)).toBe(`rm ${BASE}`);
});

it("names a failed detach and a failed install, and removes the clone", async () => {
  const detach = fakes(sim({ gitFails: "--detach" }));
  expect(await runMutate(SHARD, detach.deps)).toBe(1);
  expect(detach.err.join("")).toBe(`repo mutate: could not check out ${SHA.slice(0, 7)} in the clone: boom\n`);
  const install = fakes(sim({ installFails: true }));
  expect(await runMutate(SHARD, install.deps)).toBe(1);
  expect(install.err.join("")).toBe("repo mutate: bun install --frozen-lockfile failed in the clone: lock\n");
  expect(install.calls.at(-1)).toBe(`rm ${BASE}`);
});

it("shards the tracked matches by lines, writes the shard report and prints its line", async () => {
  const f = fakes();
  expect(await runMutate(["--shard", "2/2", "--report", OUT], f.deps)).toBe(0);
  expect(f.out.join("")).toBe(`mutate: HEAD ${SHA.slice(0, 7)}\nmutate: 1 file, shard 2/2, 0 survivors in ${OUT}\n`);
  expect(JSON.parse(f.files.get(OUT) ?? "")).toStrictEqual({
    files: { "src/b.ts": { killed: 1, survivors: [] } },
    head: SHA,
    shard: { index: 2, total: 2 },
    tool: "stryker",
  });
});

it("counts Survived and NoCoverage as survivors, Timeout as killed, and leaves out the rest", async () => {
  const report = rawReport({
    "src/a.ts": ["Killed", "Timeout", "Survived", "NoCoverage", "CompileError", "Ignored"],
  });
  const f = fakes(sim({ stryker: { code: 0, output: "", report } }));
  await runMutate(["--shard", "1/2", "--report", OUT], f.deps);
  expect(JSON.parse(f.files.get(OUT) ?? "")).toMatchObject({
    files: {
      "src/a.ts": {
        killed: 2,
        survivors: [
          { column: 2, line: 3, mutator: "ArithmeticOperator", status: "Survived" },
          { column: 2, line: 4, mutator: "ArithmeticOperator", status: "NoCoverage" },
        ],
      },
    },
  });
  expect(f.out.join("")).toContain(`2 survivors in ${OUT}`);
});

it("writes an empty report for a shard past the files without installing or running Stryker", async () => {
  const f = fakes(sim({ tracked: ["src/a.ts"] }));
  expect(await runMutate(["--shard", "2/2", "--report", OUT], f.deps)).toBe(0);
  expect(f.calls.some((c) => c.startsWith("bun"))).toBe(false);
  expect(JSON.parse(f.files.get(OUT) ?? "")).toMatchObject({ files: {}, shard: { index: 2, total: 2 } });
  expect(f.out.join("")).toContain("0 files, shard 2/2, 0 survivors");
});

it("refuses a report Stryker did not write, naming why", async () => {
  const f = fakes(sim({ stryker: { code: 0, output: "", report: { files: 3 } } }));
  expect(await runMutate(SHARD, f.deps)).toBe(1);
  expect(f.err.join("")).toMatch(/^repo mutate: Stryker wrote no readable report: .+\n$/);
  const none = fakes();
  none.deps.run = () => ({ code: 0, stderr: "", stdout: "" });
  expect(await runMutate(SHARD, none.deps)).toBe(1);
  expect(none.err.join("")).toContain("Stryker wrote no readable report: the report file is missing");
});

it("notes that uncommitted changes are not mutated, only when there are some", async () => {
  const dirty = fakes(sim({ dirty: true }));
  await runMutate(SHARD, dirty.deps);
  expect(dirty.out[0]).toBe(`mutate: HEAD ${SHA.slice(0, 7)} (uncommitted changes are not mutated)\n`);
  const clean = fakes();
  await runMutate(SHARD, clean.deps);
  expect(clean.out[0]).toBe(`mutate: HEAD ${SHA.slice(0, 7)}\n`);
});

it("prints the install line when the clone has no Stryker", async () => {
  const f = fakes(sim({ installed: false }));
  expect(await runMutate(SHARD, f.deps)).toBe(1);
  expect(f.err.join("")).toBe(INSTALL);
  expect(f.calls.at(-1)).toBe(`rm ${BASE}`);
});

it("prints Stryker's lines under the failed dry run", async () => {
  const f = fakes(sim({ stryker: { code: 1, output: "FAIL src/a.test.ts > adds\n", report: {} } }));
  expect(await runMutate(SHARD, f.deps)).toBe(1);
  expect(f.err.join("")).toBe(
    "repo mutate: the tests failed before any mutant ran; fix them first\nFAIL src/a.test.ts > adds\n",
  );
});

it("names the glob when no tracked file matches, before any clone", async () => {
  const f = fakes(sim({ tracked: ["docs/x.ts"] }));
  expect(await runMutate(SHARD, f.deps)).toBe(1);
  expect(f.err.join("")).toBe(
    "repo mutate: no tracked file matches coverage.mutate (src/**/*.ts); set coverage.mutate in " +
      "workerstack.config.ts\n",
  );
  expect(f.calls.some((c) => c.includes("clone") || c.startsWith("mkdtemp"))).toBe(false);
});

it("refuses a bad --shard before touching git, and prints the config's errors", async () => {
  const bad = fakes();
  expect(await runMutate(["--shard", "9/8"], bad.deps)).toBe(1);
  expect(bad.err.join("")).toBe("repo mutate: --shard takes i/n with 1 <= i <= n, such as 2/8\n");
  expect(bad.calls).toStrictEqual([]);
  const noConfig = fakes(sim({ config: ["workerstack.config.ts: no default export"] }));
  expect(await runMutate(SHARD, noConfig.deps)).toBe(1);
  expect(noConfig.err.join("")).toBe("repo mutate: workerstack.config.ts: no default export\n");
});

it("says so when the directory is no git repository", async () => {
  const f = fakes(sim({ gitFails: "rev-parse" }));
  expect(await runMutate(SHARD, f.deps)).toBe(1);
  expect(f.err.join("")).toBe(`repo mutate: ${ROOT} has no commit to mutate: boom\n`);
});
