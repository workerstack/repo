/** The real collaborators of `repo mutate`: git, bun, the file system, the config and the workspace. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CONFIG_FILE } from "./config.constants.ts";
import { findRoot, loadConfig } from "./config.ts";
import { childEnv } from "./env.ts";
import type { MutateDeps, MutateFs } from "./mutate-deps.ts";
import { CARGO_MANIFEST, ROOT_PACKAGE } from "./mutate.constants.ts";
import { workspaceCrates } from "./rust/cargo-metadata.ts";
import { runCargo, type CargoRun } from "./rust/clippy.ts";
import { captureBun, type Captured } from "./scripts/lint.ts";
import { toolEnv } from "./scripts/tool-env.ts";
import { spawnSync } from "./spawn.ts";
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
  rm: (target) => fs.rmSync(target, { force: true, recursive: true }),
  write: (file, text) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  },
};

/** The root and the `coverage` keys of the repo holding `cwd`, or the lines that say why there is none. */
async function config(cwd: string): ReturnType<MutateDeps["config"]> {
  const root = findRoot(cwd);

  if (root === null) return [`no ${CONFIG_FILE} in ${cwd} or any parent; run \`bun repo init\``];
  const loaded = await loadConfig(root);

  if (!loaded.ok) return loaded.errors;

  return { floors: loaded.config.coverage.mutationFloors, mutate: loaded.config.coverage.mutate, root };
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
    const node = read.ok ? read.workspace.packages.map((pkg) => pkg.dir) : [];

    return [...node, ...crateDirs(root, cargo)];
  };
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
    out: (text) => process.stdout.write(text),
    packages: packagesWith(runCargo),
    preload: path.join(import.meta.dirname, "stryker-preload.ts"),
    run: (args, where) => captureBun(args, where, childEnv()),
  };
}
