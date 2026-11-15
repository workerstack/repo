/** The real collaborators of `repo mutate`: git, bun, the file system, the config and the workspace. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import { findRoot, loadConfig, missingConfig } from "./config.ts";
import { childEnv } from "./env.ts";
import type { MutateDeps, MutateFs } from "./mutate-deps.ts";
import { CARGO_MANIFEST, ROOT_PACKAGE } from "./mutate.constants.ts";
import { removeTree } from "./remove-tree.ts";
import { workspaceCrates } from "./rust/cargo-metadata.ts";
import { runCargo, type CargoRun } from "./rust/clippy.ts";
import { capture, captureBun, type Captured } from "./scripts/lint.ts";
import { missingNode, NODE_CONFIG, nodeRangesAt } from "./scripts/node-run.ts";
import { toolEnv } from "./scripts/tool-env.ts";
import { spawnSync } from "./spawn.ts";
import { errorMessage } from "./sync-errors.ts";
import { readWorkspace } from "./sync/workspace.ts";

/** `git <args>` in `cwd`, run without any `GIT_*` variable a hook set, which would aim it at another repo. */
function git(cwd: string, args: string[]): Captured {
  const run = spawnSync("git", args, { cwd, encoding: "utf8", env: toolEnv(childEnv()) });

  return { code: run.status ?? 1, stderr: run.error?.message ?? run.stderr, stdout: run.stdout };
}

export const realFs: MutateFs = {
  list: (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir) : null),
  mkdtemp: (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix)),
  read: (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null),
  rm: (target) => removeTree(target),
  write: (file, text) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  },
};

/** The root and the `coverage` keys of the repo holding `cwd`, or the lines that say why there is none. */
async function config(cwd: string): ReturnType<MutateDeps["config"]> {
  const root = findRoot(cwd);

  if (root === null) return [missingConfig(cwd)];
  const loaded = await loadConfig(root);

  if (!loaded.ok) return loaded.errors;

  const { mutate, mutateExclude: exclude, mutationFloors: floors } = loaded.config.coverage;

  return { exclude, floors, mutate, root };
}

/**
 * The dirs of the Cargo workspace members of `root`, root-relative; none without a root Cargo.toml or when cargo
 * cannot say.
 */
function crateDirs(root: string, cargo: CargoRun): string[] {
  if (!fs.existsSync(path.join(root, CARGO_MANIFEST))) return [];
  const found = workspaceCrates(root, cargo);

  if (found.kind !== "crates") return [];
  const dirs = found.crates.map((crate) => path.relative(root, path.dirname(crate.manifest_path)));

  return dirs.map((dir) => {
    const slashed = dir.split(path.sep).join("/");

    return slashed === "" ? ROOT_PACKAGE : slashed;
  });
}

/**
 * The workspace package dirs of `root` and its Cargo member dirs; an unreadable manifest is `repo check`'s to
 * report, so none here.
 */
export function packagesWith(cargo: CargoRun): MutateDeps["packages"] {
  return (root) => {
    const read = readWorkspace(root);
    const dirs = read.ok ? read.workspace.packages.map((pkg) => pkg.dir) : [];

    return [...dirs, ...crateDirs(root, cargo)];
  };
}

/**
 * `node <args>` in `cwd`; when node is not on PATH, the line naming the range the repo at `cwd` declares for its node
 * run, else for its packages.
 */
async function node(...[args, cwd, env]: Parameters<MutateDeps["node"]>): ReturnType<MutateDeps["node"]> {
  const vars = { ...childEnv(), ...env };

  if (Bun.which("node", vars) === null) {
    const ranges = nodeRangesAt(cwd);
    const range = ranges.ok ? (ranges.value.dev ?? ranges.value.engines) : undefined;

    return { error: missingNode("repo mutate", range), ok: false };
  }

  return { ok: true, value: await capture("node", args, { cwd, env: vars }) };
}

/** A node config module as `nodeGlobs` reads it: its default export's coverage globs. */
function buildNodeConfigSchema() {
  return z.object({ default: z.object({ test: z.object({ coverage: z.object({ include: z.array(z.string()) }) }) }) });
}

const nodeConfigSchema = /* @__PURE__ */ buildNodeConfigSchema();

/** The coverage globs of the clone's node config, loaded from the clone's own install; none without the file. */
async function nodeGlobs(clone: string): ReturnType<MutateDeps["nodeGlobs"]> {
  const file = path.join(clone, NODE_CONFIG);

  if (!fs.existsSync(file)) return { ok: true, value: null };
  let loaded: unknown;

  try {
    loaded = await import(pathToFileURL(file).href);
  } catch (error) {
    return { error: `could not load ${NODE_CONFIG}: ${errorMessage(error)}`, ok: false };
  }

  const parsed = nodeConfigSchema.safeParse(loaded);

  if (parsed.success) return { ok: true, value: parsed.data.default.test.coverage.include };

  return { error: `${NODE_CONFIG} sets no test.coverage.include; name the files its tests cover`, ok: false };
}

/** The collaborators of a run in `cwd`. */
export function realDeps(cwd: string): MutateDeps {
  return {
    cargo: runCargo,
    config,
    cwd,
    err: (text) => process.stderr.write(text),
    fs: realFs,
    git,
    node,
    nodeGlobs,
    out: (text) => process.stdout.write(text),
    packages: packagesWith(runCargo),
    preload: path.join(import.meta.dirname, "stryker-preload.ts"),
    run: async (args, where, env) => await captureBun(args, where, { ...childEnv(), ...env }),
  };
}
