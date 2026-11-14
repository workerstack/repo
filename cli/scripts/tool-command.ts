/** The bun command line and environment that run oxlint or bun fmt, as `repo lint` and `repo fmt` run them. */
import path from "node:path";

import { WINDOWS_PLATFORM } from "../actionlint.constants.ts";
import { childEnv } from "../env.ts";
import { repoEnv } from "../repo-env.ts";
import { BUN_FMT_ARGS, MODULES_DIR } from "./lint.constants.ts";
import type { Tool } from "./lint.ts";
import { packageBin } from "./package-bin.ts";

/** The arguments bun runs a tool with and the environment it runs in. */
type ToolCommand = { args: string[]; env: NodeJS.ProcessEnv };

/** The file a package export resolves to, from this package's install. */
function resolved(specifier: string): string {
  // Bun.resolveSync, not import.meta.resolve: vitest's transform drops the latter, and tests run this in-process.
  return Bun.resolveSync(specifier, import.meta.dirname);
}

/** oxlint's bin script, read from its package.json; it is a node shim, so bun runs it. */
function oxlintBin(): string {
  return packageBin(resolved("oxlint/package.json"), "oxlint");
}

/**
 * The node_modules dir holding `@workerstack/repo` for this package at `packageRoot`: the one its scope dir sits in
 * when installed (bunx, a consumer), else the root's own, which a dev checkout fills with a self-link.
 */
export function pluginModules(packageRoot: string): string {
  const modules = path.dirname(path.dirname(packageRoot));

  return path.basename(modules) === MODULES_DIR ? modules : path.join(packageRoot, MODULES_DIR);
}

/** The package export of the native tsgolint binary for a platform and arch; Windows' ends in `.exe`. */
export function tsgolintSpecifier(platform: NodeJS.Platform, arch: string): string {
  return `@oxlint-tsgolint/${platform}-${arch}/tsgolint${platform === WINDOWS_PLATFORM ? ".exe" : ""}`;
}

/**
 * What oxlint needs beyond the inherited environment: the native tsgolint binary, which its own lookup would reach
 * through a node shim, and a NODE_PATH led by the node_modules holding this package, so the config's
 * `@workerstack/repo/lint` plugin loads in a repo with no install of its own.
 */
function oxlintEnv(): NodeJS.ProcessEnv {
  const modules = pluginModules(path.resolve(import.meta.dirname, "..", ".."));
  const inherited = repoEnv.process.NODE_PATH;

  return {
    NODE_PATH: inherited !== undefined && inherited !== "" ? `${modules}${path.delimiter}${inherited}` : modules,
    OXLINT_TSGOLINT_PATH: resolved(tsgolintSpecifier(process.platform, process.arch)),
  };
}

/** The bun command line and environment that run `tool`: oxlint's bin, or bun's own formatter past any `fmt` script. */
export function toolCommand(tool: Tool): ToolCommand {
  if (tool === "bun fmt") return { args: [...BUN_FMT_ARGS], env: childEnv() };

  return { args: [oxlintBin()], env: childEnv(oxlintEnv()) };
}
