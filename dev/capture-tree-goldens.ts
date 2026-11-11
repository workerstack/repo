#!/usr/bin/env bun
/**
 * Captures the agent-tree goldens: `renderTrees` run on the consumer fixture (`cli/sync/fixtures/consumer`, a
 * `.repo/` overlay, all five hosts) over a frozen stock snapshot (`cli/sync/fixtures/consumer-stock`), so a stock
 * edit never moves them. Every generated file except `.vscode/tasks.json` lands under `cli/sync/fixtures/golden/`,
 * which is wiped first. `cli/sync/golden.test.ts` renders the same fixture through `renderFixtureTrees` and
 * compares byte for byte.
 *
 * The fixture's `node_modules/@workerstack/repo` links to the snapshot by absolute path. The goldens were first
 * captured from rulesync 43.7.0; the trees now come from `cli/sync/agents/`.
 *
 * Run: `bun dev/capture-tree-goldens.ts`
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "../cli/config.ts";
import type { Output } from "../cli/sync/outputs.ts";
import { PACKAGE_NAME } from "../cli/sync/stock.ts";
import { renderTrees } from "../cli/sync/trees.ts";
import { readWorkspace } from "../cli/sync/workspace.ts";
import * as K from "./capture-tree-goldens.constants.ts";

/** Where the fixtures live: the repo root, the consumer overlay, its frozen stock snapshot and the goldens. */
export function fixtureDirs(): { root: string; consumer: string; stock: string; golden: string } {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const fixtures = path.join(root, ...K.FIXTURES);
  return {
    consumer: path.join(fixtures, K.CONSUMER),
    golden: path.join(fixtures, K.GOLDEN),
    root,
    stock: path.join(fixtures, K.STOCK),
  };
}

/** A file under `root` read as text, or null when it cannot be read. */
function readUnder(root: string, rel: string): string | null {
  try {
    return fs.readFileSync(path.join(root, rel), "utf8");
  } catch {
    return null;
  }
}

/** Renders the trees of the workspace copied to `root`, or throws the errors that stopped it. */
async function renderAt(root: string): Promise<Output[]> {
  const config = await loadConfig(root);
  if (!config.ok) throw new Error(config.errors.join("\n"));
  const workspace = readWorkspace(root);
  if (!workspace.ok) throw new Error(workspace.errors.join("\n"));
  const result = renderTrees({
    config: config.config,
    read: (rel) => readUnder(root, rel),
    root,
    workspace: workspace.workspace,
  });
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.outputs;
}

/** Every generated tree file of the consumer fixture over the frozen stock, by POSIX path, sorted. */
export async function renderFixtureTrees(): Promise<Map<string, string>> {
  const dirs = fixtureDirs();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), K.TEMP_PREFIX));
  try {
    fs.cpSync(dirs.consumer, root, { recursive: true });
    const link = path.join(root, "node_modules", ...PACKAGE_NAME.split("/"));
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(dirs.stock, link, process.platform === K.WINDOWS ? "junction" : "dir");
    const outputs = await renderAt(root);
    const files = new Map<string, string>();
    for (const output of outputs)
      if (output.kind === "file" && output.path !== K.TASKS_REL) files.set(output.path, output.content);

    return new Map([...files].sort(([a], [b]) => Number(a > b) - Number(a < b)));
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
}

/** The committed goldens, by POSIX path, sorted. */
export function readGoldens(): Map<string, string> {
  const { golden } = fixtureDirs();
  const rels = fs
    .readdirSync(golden, { encoding: "utf8", recursive: true })
    .map((rel) => rel.replaceAll("\\", "/"))
    .filter((rel) => fs.statSync(path.join(golden, rel)).isFile())
    .sort();
  return new Map(rels.map((rel) => [rel, fs.readFileSync(path.join(golden, rel), "utf8")]));
}

/** Where the capture writes its one line. */
type Io = { out: (text: string) => void };

/** Wipes and rewrites the goldens from a fresh render; returns the exit code. */
async function run(io: Io): Promise<number> {
  const { root, golden } = fixtureDirs();
  const files = await renderFixtureTrees();
  fs.rmSync(golden, { force: true, recursive: true });
  for (const [rel, content] of files) {
    const file = path.join(golden, ...rel.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  io.out(`${K.NAME}: wrote ${files.size} files to ${path.relative(root, golden)}\n`);
  return 0;
}

if (import.meta.main) process.exitCode = await run({ out: (text) => process.stdout.write(text) });
