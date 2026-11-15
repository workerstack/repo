import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { BASE, CLONE, OUT, ROOT, fakes, rawReport, sim, type Sim } from "./__fixtures__/mutate-fakes.ts";
import { runMutate } from "./mutate.ts";

const WHOLE = ["--report", OUT];
const MISSING = "repo mutate: vitest.node.config.ts runs on node, but node is not on PATH; install node >=22.12.0\n";

/** A repo whose node config covers `lint/**`: one main source, one node source, each with mutants. */
function withNode(over: Partial<Sim> = {}): Sim {
  return sim({
    config: {
      exclude: ["x.test.ts"],
      floors: "mutation-floors.json",
      mutate: ["src/**/*.ts", "lint/**/*.ts"],
      root: ROOT,
    },
    nodeGlobs: { ok: true, value: ["lint/**/*.ts"] },
    sources: { "lint/r.ts": "r\n".repeat(20), "src/a.ts": "a\n".repeat(30) },
    stryker: {
      code: 0,
      output: "",
      report: rawReport({ "lint/r.ts": ["Killed", "Killed"], "src/a.ts": ["Killed", "Survived"] }),
    },
    tracked: ["src/a.ts", "lint/r.ts", "lint/r.test.ts"],
    ...over,
  });
}

type Written = { files: Record<string, { killed: number }>; tool: string };

function report(files: Map<string, string>): Written {
  return JSON.parse(files.get(OUT) ?? "{}") /* the report the command wrote */ as Written;
}

function configAt(files: Map<string, string>, name: string): { mutate: string[]; vitest: Record<string, string> } {
  return JSON.parse(files.get(path.join(BASE, name)) ?? "{}") /* the Stryker config the command wrote */ as never;
}

it("runs the node config's files through node with that config and no preload, the rest under bun", async () => {
  const f = fakes(withNode());
  const written = new Map<string, string>();
  const write = f.deps.fs.write;
  f.deps.fs.write = (file, text) => {
    written.set(file, text);
    write(file, text);
  };

  expect(await runMutate(WHOLE, f.deps), f.err.join("")).toBe(0);
  const bin = path.join(CLONE, "node_modules/@stryker-mutator/core/bin/stryker.js");
  const env = ` env ${JSON.stringify({ REPO_VITEST_EXCLUDE: '["x.test.ts"]' })}`;
  const runs = f.calls.filter((c) => c.includes("stryker.js"));
  expect(runs).toStrictEqual([
    `bun --bun --preload /pkg/cli/stryker-preload.ts ${bin} run ${path.join(BASE, "stryker.json")} @${CLONE}${env}`,
    `node ${bin} run ${path.join(BASE, "node-stryker.json")} @${CLONE}${env}`,
  ]);
  expect(configAt(written, "stryker.json").mutate).toStrictEqual(["src/a.ts"]);
  expect(configAt(written, "stryker.json").vitest).toStrictEqual({ pool: "forks" });
  expect(configAt(written, "node-stryker.json").mutate).toStrictEqual(["lint/r.ts"]);
  expect(configAt(written, "node-stryker.json").vitest).toStrictEqual({
    configFile: "vitest.node.config.ts",
    pool: "forks",
  });
  expect(report(written).files).toStrictEqual({
    "lint/r.ts": { killed: 2, survivors: [] },
    "src/a.ts": { killed: 1, survivors: [{ column: 2, line: 2, mutator: "ArithmeticOperator", status: "Survived" }] },
  });
});

it("reads the node config's globs only after the install, from the clone", async () => {
  const f = fakes(withNode());
  await runMutate(WHOLE, f.deps);
  const install = f.calls.indexOf(`bun install --frozen-lockfile @${CLONE}`);
  const globs = f.calls.indexOf(`nodeGlobs ${CLONE}`);
  expect(install).toBeGreaterThan(-1);
  expect(globs).toBeGreaterThan(install);
});

it("runs only under bun when the repo has no node config", async () => {
  const f = fakes(withNode({ nodeGlobs: { ok: true, value: null } }));
  expect(await runMutate(WHOLE, f.deps)).toBe(0);
  const runs = f.calls.filter((c) => c.includes("stryker.js"));
  expect(runs).toHaveLength(1);
  expect(runs[0]?.startsWith("bun --bun --preload")).toBe(true);
  expect(Object.keys(report(f.files).files)).toStrictEqual(["lint/r.ts", "src/a.ts"]);
});

it("skips node when the shard holds no file the node config covers, and bun when it holds only those", async () => {
  const mainOnly = fakes(withNode({ nodeGlobs: { ok: true, value: ["other/**"] } }));
  await runMutate(WHOLE, mainOnly.deps);
  expect(mainOnly.calls.filter((c) => c.startsWith("node "))).toStrictEqual([]);

  const nodeOnly = fakes(withNode({ nodeGlobs: { ok: true, value: ["**/*.ts"] } }));
  await runMutate(WHOLE, nodeOnly.deps);
  expect(nodeOnly.calls.filter((c) => c.includes("stryker.js")).map((c) => c.split(" ")[0])).toStrictEqual(["node"]);
});

it("prints the missing node line once and fails when node is not on PATH", async () => {
  const f = fakes(withNode({ nodeMissing: MISSING.trimEnd() }));
  expect(await runMutate(WHOLE, f.deps)).toBe(1);
  expect(f.err.join("")).toBe(MISSING);
  expect(fs.existsSync(OUT)).toBe(false);
  expect(f.files.has(OUT)).toBe(false);
});

it("prints the node config's own refusal once and runs no Stryker when its globs cannot be read", async () => {
  const line = "vitest.node.config.ts sets no test.coverage.include; name the files its tests cover";
  const f = fakes(withNode({ nodeGlobs: { error: line, ok: false } }));
  expect(await runMutate(WHOLE, f.deps)).toBe(1);
  expect(f.err.join("")).toBe(`repo mutate: ${line}\n`);
  expect(f.calls.filter((c) => c.includes("stryker.js"))).toStrictEqual([]);
  expect(f.calls.at(-1)).toBe(`rm ${BASE}`);
});
