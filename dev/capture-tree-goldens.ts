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
import { renderTrees } from "../cli/sync/trees.ts";
import { readWorkspace } from "../cli/sync/workspace.ts";
import { PACKAGE_NAME } from "../cli/sync/stock.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = path.join(ROOT, "cli", "sync", "fixtures");
export const CONSUMER_DIR: string = path.join(FIXTURES, "consumer");
export const STOCK_DIR: string = path.join(FIXTURES, "consumer-stock");
const GOLDEN_DIR: string = path.join(FIXTURES, "golden");
/** Committed in every workspace and not a generated tree file, so the goldens leave it out. */
const TASKS_REL = ".vscode/tasks.json";

/** Every generated tree file of the consumer fixture over the frozen stock, by POSIX path, sorted. */
export async function renderFixtureTrees(): Promise<Map<string, string>> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-golden-"));
  try {
    fs.cpSync(CONSUMER_DIR, root, { recursive: true });
    const link = path.join(root, "node_modules", ...PACKAGE_NAME.split("/"));
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(STOCK_DIR, link, process.platform === "win32" ? "junction" : "dir");

    const config = await loadConfig(root);
    if (!config.ok) throw new Error(config.errors.join("\n"));
    const workspace = readWorkspace(root);
    if (!workspace.ok) throw new Error(workspace.errors.join("\n"));
    const result = renderTrees({
      root,
      config: config.config,
      workspace: workspace.workspace,
      read: (rel) => {
        try {
          return fs.readFileSync(path.join(root, rel), "utf8");
        } catch {
          return null;
        }
      },
    });
    if (!result.ok) throw new Error(result.errors.join("\n"));

    const files = new Map<string, string>();
    for (const output of result.outputs) {
      if (output.kind === "file" && output.path !== TASKS_REL) files.set(output.path, output.content);
    }
    return new Map([...files].sort(([a], [b]) => Number(a > b) - Number(a < b)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** The committed goldens, by POSIX path, sorted. */
export function readGoldens(): Map<string, string> {
  const rels = fs
    .readdirSync(GOLDEN_DIR, { recursive: true, encoding: "utf8" })
    .map((rel) => rel.replaceAll("\\", "/"))
    .filter((rel) => fs.statSync(path.join(GOLDEN_DIR, rel)).isFile())
    .sort();
  return new Map(rels.map((rel) => [rel, fs.readFileSync(path.join(GOLDEN_DIR, rel), "utf8")]));
}

async function capture(): Promise<void> {
  const files = await renderFixtureTrees();
  fs.rmSync(GOLDEN_DIR, { recursive: true, force: true });
  for (const [rel, content] of files) {
    const file = path.join(GOLDEN_DIR, ...rel.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  console.log(`capture-tree-goldens: wrote ${files.size} files to ${path.relative(ROOT, GOLDEN_DIR)}`);
}

if (import.meta.main) await capture();
