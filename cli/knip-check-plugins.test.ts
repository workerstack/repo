import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { knipRoot, removeKnipRoots, report } from "./__fixtures__/knip-run.ts";
import { checkKnipAt, checkKnip, type KnipRun } from "./knip-check.ts";
import { knipConfig } from "./sync/knip-config.ts";

afterEach(removeKnipRoots);

/** A runner that records the unignored config it is handed, which exists only for the run. */
function reading(root: string): KnipRun & { seen: string[] } {
  const seen: string[] = [];

  function run(args: string[]): Promise<{ code: number; stderr: string; stdout: string }> {
    seen.push(fs.readFileSync(path.join(root, args[args.indexOf("--config") + 1] ?? ""), "utf8"));

    return Promise.resolve({ code: 0, stderr: "", stdout: report() });
  }

  return Object.assign(run, { seen });
}

it("writes the lint plugin files as entries of the unignored config, so knip does not report them unused", async () => {
  const ws = knipRoot({});
  const runner = reading(ws.root);
  await checkKnip({ ignores: [], plugins: ["lint/app.js"], run: runner, workspace: ws });
  expect(runner.seen).toStrictEqual([knipConfig(ws, [], ["lint/app.js"])]);
  expect(runner.seen[0]).toContain('"lint/app.js"');
});

it("checkKnipAt passes the config's lint.plugins files", async () => {
  const plugin = 'export default { meta: { name: "app" }, rules: { "no-x": {} } };\n';
  const config = 'export default { packs: ["standards"], lint: { plugins: { app: "lint/app.js" } } };\n';
  const ws = knipRoot({ "lint/app.js": plugin, "repo.config.ts": config });
  const runner = reading(ws.root);
  await checkKnipAt(ws.root, { run: runner });
  expect(runner.seen[0]).toContain('"lint/app.js"');
});
