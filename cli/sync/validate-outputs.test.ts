import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import { readGoldens, renderFixtureTrees } from "../../dev/capture-tree-goldens.ts";
import { BASE_CONFIG } from "../__fixtures__/base-config.ts";
import { AGENT_DEFAULTS } from "../agent-defaults.constants.ts";
import { loadConfig } from "../config.ts";
import { computeOutputs } from "../sync-outputs.ts";
import { runSync } from "../sync.ts";
import { file } from "./__fixtures__/outputs-kit.ts";
import { tempDir, useTempDirs } from "./__fixtures__/temp-dirs.ts";
import { rust } from "./rust.ts";
import { validateOutputs } from "./validate-outputs.ts";
import { readWorkspace } from "./workspace.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SLOW = 60_000;

useTempDirs();

function tmpRoot(): string {
  return tempDir("workerstack-validate-");
}

it("accepts every output of the golden consumer fixture", { timeout: SLOW }, async () => {
  const rendered = await renderFixtureTrees();
  expect([...rendered.keys()]).toStrictEqual([...readGoldens().keys()]);
  const outputs = [...rendered].map(([rel, content]) => file(rel, content));
  expect(outputs.length).toBeGreaterThan(30);
  expect(validateOutputs(tmpRoot(), outputs)).toStrictEqual([]);
});

it("accepts every output this repo plans", { timeout: SLOW }, async () => {
  const config = await loadConfig(REPO_ROOT);
  const workspace = readWorkspace(REPO_ROOT);

  if (!config.ok || !workspace.ok) throw new Error("this repo's config or workspace did not load");
  const planned = computeOutputs({ config: config.config, root: REPO_ROOT, workspace: workspace.workspace });

  if (!planned.ok) throw new Error(planned.errors.join("\n"));
  expect(planned.outputs.length).toBeGreaterThan(100);
  expect(validateOutputs(REPO_ROOT, planned.outputs)).toStrictEqual([]);
});

it("validates all four through a real sync of a root with a Cargo.toml and the standards pack", async () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, "repo.config.ts"), "export default {};\n");
  fs.writeFileSync(path.join(root, "package.json"), '{ "name": "app" }\n');
  fs.writeFileSync(path.join(root, "Cargo.toml"), '[package]\nname = "app"\n');

  const config = {
    agents: { ...AGENT_DEFAULTS, hosts: [], skills: [] },
    packs: ["standards" as const],
    ...BASE_CONFIG,
  };

  const err: string[] = [];
  const io = { cwd: root, stderr: (s: string) => err.push(s), stdout: () => {} };

  const code = await runSync([], io, {
    generators: [rust],
    load: () => Promise.resolve({ config, ok: true as const }),
    post: [],
  });

  expect(err).toStrictEqual([]);
  expect(code).toBe(0);

  for (const rel of ["rust-toolchain.toml", "rustfmt.toml", "clippy.toml", "deny.toml"])
    expect(fs.existsSync(path.join(root, rel))).toBe(true);
});
