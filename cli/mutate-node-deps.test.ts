import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, expect, it, vi } from "vitest";

import { removeTemps } from "./__fixtures__/remove-temps.ts";
import { realDeps } from "./mutate-real-deps.ts";

const dirs: string[] = [];

afterAll(() => {
  removeTemps(dirs);
});

/** A clone holding `vitest.node.config.ts` with `source`, or no node config when `source` is null. */
function clone(source: string | null): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-node-globs-"));
  dirs.push(dir);

  if (source !== null) fs.writeFileSync(path.join(dir, "vitest.node.config.ts"), source);

  return dir;
}

const { node, nodeGlobs } = realDeps(process.cwd());

it("reads the globs the node config's coverage includes", async () => {
  const dir = clone('export default { test: { coverage: { include: ["lint/**/*.ts"] } } };\n');
  expect(await nodeGlobs(dir)).toStrictEqual({ ok: true, value: ["lint/**/*.ts"] });
});

it("answers none for a clone with no node config", async () => {
  expect(await nodeGlobs(clone(null))).toStrictEqual({ ok: true, value: null });
});

it("refuses a node config that names no coverage include", async () => {
  expect(await nodeGlobs(clone("export default { test: {} };\n"))).toStrictEqual({
    error: "vitest.node.config.ts sets no test.coverage.include; name the files its tests cover",
    ok: false,
  });
});

it("refuses a node config that throws as it loads, with the error's own words", async () => {
  expect(await nodeGlobs(clone('throw new Error("bad config");\n'))).toStrictEqual({
    error: "could not load vitest.node.config.ts: bad config",
    ok: false,
  });
});

it("runs node in the dir with the variables given", async () => {
  const dir = clone(null);
  const ran = await node(["-e", "process.stdout.write(process.cwd() + ' ' + process.env.MARK)"], dir, { MARK: "m" });
  expect(ran).toStrictEqual({ ok: true, value: { code: 0, stderr: "", stdout: `${fs.realpathSync(dir)} m` } });
});

it("names the node range the repo declares when node is not on PATH", async () => {
  const dir = clone(null);
  const runtime = { name: "node", version: ">=22.12.0" };
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ devEngines: { runtime }, name: "x" }));
  vi.stubEnv("PATH", clone(null));
  expect(await node(["-v"], dir)).toStrictEqual({
    error: "repo mutate: vitest.node.config.ts runs on node, but node is not on PATH; install node >=22.12.0",
    ok: false,
  });
});

it("names the engines.node range when the repo declares no devEngines one", async () => {
  const dir = clone(null);
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ engines: { node: ">=24" }, name: "x" }));
  vi.stubEnv("PATH", clone(null));
  expect(await node(["-v"], dir)).toStrictEqual({
    error: "repo mutate: vitest.node.config.ts runs on node, but node is not on PATH; install node >=24",
    ok: false,
  });
});

it("says only to install node when the repo declares no range, or its manifest will not read", async () => {
  const bare = clone(null);
  const broken = clone(null);
  fs.writeFileSync(path.join(broken, "package.json"), "{");
  vi.stubEnv("PATH", clone(null));
  const line = "repo mutate: vitest.node.config.ts runs on node, but node is not on PATH; install node";
  expect(await node(["-v"], bare)).toStrictEqual({ error: line, ok: false });
  expect(await node(["-v"], broken)).toStrictEqual({ error: line, ok: false });
});
