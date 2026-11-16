/**
 * A package's second vitest run: `vitest.node.config.ts`, beside the main config, holds tests that only run on Node
 * (oxlint's `RuleTester` refuses Bun), so every gate that runs a package's tests runs that config too, on node.
 */
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { findRoot } from "../config.ts";
import { tryJson } from "../json.ts";
import { NESTED_VITEST_FLAGS } from "../nested-vitest-flags.ts";
import type { Result } from "../result.ts";
import { devNodeRange, nodeRange } from "../sync/node-range.ts";
import { readWorkspace } from "../sync/workspace.ts";
import { packageBin } from "./package-bin.ts";

/** The config of the node run, at a package's root. */
export const NODE_CONFIG = "vitest.node.config.ts";

/** Which of a package's vitest runs: its main config, or the node config on node. */
export type TestRun = "main" | "node";

/** A vitest config file's name: `vitest.config.ts`, `vitest.node.config.mts` and the like. */
const VITEST_CONFIG_NAME = /^vitest(?:\.[\w-]+)?\.config\.[cm]?[jt]s$/;

/** The dependency maps of a package.json, the only part `declaresVitest` reads. */
function dependencyMapsSchema() {
  const map = z.record(z.string(), z.unknown()).optional();

  return z.object({ dependencies: map, devDependencies: map, optionalDependencies: map, peerDependencies: map });
}

/** Whether the package.json in `dir` names vitest in any dependency map; a missing or unreadable one does not. */
function declaresVitest(dir: string): boolean {
  let text: string;

  try {
    text = fs.readFileSync(path.join(dir, "package.json"), "utf8");
  } catch {
    return false;
  }

  const maps = tryJson(dependencyMapsSchema(), text);

  if (maps === undefined) return false;
  const { dependencies, devDependencies, optionalDependencies, peerDependencies } = maps;

  return [dependencies, devDependencies, optionalDependencies, peerDependencies].some((map) =>
    Object.hasOwn(map ?? {}, "vitest"),
  );
}

/**
 * Whether the workspace member at `dir` tests with vitest: when it declares vitest or holds a vitest config. One that
 * tests with `bun test` or playwright finds the root's vitest hoisted all the same, and a run would load its vite
 * config as a test config.
 */
function memberTestsWithVitest(dir: string): boolean {
  return declaresVitest(dir) || fs.readdirSync(dir).some((name) => VITEST_CONFIG_NAME.test(name));
}

/**
 * The runs of the package at `dir`: the main one, then the node one when `dir` holds the node config. The root, where
 * the shared dev tools install, always has them; a `member` only when it tests with vitest, else none.
 */
export function testRuns(dir: string, { member = false }: { member?: boolean } = {}): readonly TestRun[] {
  if (member && !memberTestsWithVitest(dir)) return [];

  return fs.existsSync(path.join(dir, NODE_CONFIG)) ? ["main", "node"] : ["main"];
}

/** The node ranges of a workspace: `engines` runs the whole suite on node, `dev` is what the node run needs. */
export type NodeRanges = { engines: string | undefined; dev: string | undefined };

/**
 * The node ranges of the workspace holding `cwd` (its repo root, else `cwd` itself), so a package dir sees a range
 * its root or a sibling declares; a workspace that cannot be read or declares two ranges fails as sync would.
 */
export function nodeRangesAt(cwd: string): Result<NodeRanges, string> {
  const read = readWorkspace(findRoot(cwd) ?? cwd);

  if (!read.ok) return { error: read.errors.join("; "), ok: false };
  const engines = nodeRange(read.workspace);
  const dev = devNodeRange(read.workspace);

  if (!engines.ok) return engines;

  return dev.ok ? { ok: true, value: { dev: dev.value, engines: engines.value } } : dev;
}

/** The vitest argv of `run` from the install of the package at `cwd`, or null when vitest does not resolve there. */
export function vitestCommand(cwd: string, run: TestRun, args: readonly string[]): string[] | null {
  let manifest: string;

  try {
    manifest = Bun.resolveSync("vitest/package.json", cwd);
  } catch {
    return null;
  }

  const config = run === "node" ? ["-c", NODE_CONFIG] : [];

  return [packageBin(manifest, "vitest"), ...NESTED_VITEST_FLAGS, ...config, ...args];
}

/**
 * The line `command` prints when the node run cannot start because node is not on PATH, naming the range to install
 * when one is declared.
 */
export function missingNode(command: string, range: string | undefined): string {
  const install = range === undefined ? "install node" : `install node ${range}`;

  return `${command}: ${NODE_CONFIG} runs on node, but node is not on PATH; ${install}`;
}

/** Where the node run writes its json report: beside `json`, the main run's. */
export function nodeReport(json: string): string {
  return path.join(path.dirname(json), `node-${path.basename(json)}`);
}
