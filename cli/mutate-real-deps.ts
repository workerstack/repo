/** The real collaborators of `repo mutate`: git, bun, the file system, the config and the workspace. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CONFIG_FILE, findRoot, loadConfig } from "./config.ts";
import { childEnv } from "./env.ts";
import type { MutateDeps, MutateFs } from "./mutate-deps.ts";
import { captureBun, toolEnv, type Captured } from "./scripts/lint.ts";
import { spawnSync } from "./spawn.ts";
import { readWorkspace } from "./sync/workspace.ts";

/** `git <args>` in `cwd`, run without any `GIT_*` variable a hook set, which would aim it at another repo. */
function git(cwd: string, args: string[]): Captured {
  const run = spawnSync("git", args, { cwd, encoding: "utf8", env: toolEnv(childEnv()) });
  return { code: run.status ?? 1, stdout: run.stdout, stderr: run.error?.message ?? run.stderr };
}

export const realFs: MutateFs = {
  mkdtemp: (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix)),
  rm: (target) => fs.rmSync(target, { recursive: true, force: true }),
  read: (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null),
  write: (file, text) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  },
  list: (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir) : null),
};

/** The root and the `coverage` keys of the repo holding `cwd`, or the lines that say why there is none. */
async function config(cwd: string): ReturnType<MutateDeps["config"]> {
  const root = findRoot(cwd);
  if (root === null) return [`no ${CONFIG_FILE} in ${cwd} or any parent; run \`bun repo init\``];
  const loaded = await loadConfig(root);
  if (!loaded.ok) return loaded.errors;
  return { root, mutate: loaded.config.coverage.mutate, floors: loaded.config.coverage.mutationFloors };
}

/** The workspace package dirs of `root`; an unreadable manifest is `repo check`'s to report, so none here. */
function packages(root: string): string[] {
  const read = readWorkspace(root);
  return read.ok ? read.workspace.packages.map((pkg) => pkg.dir) : [];
}

/** The collaborators of a run in `cwd`. */
export function realDeps(cwd: string): MutateDeps {
  return {
    cwd,
    config,
    packages,
    git,
    run: (args, where) => captureBun(args, where, childEnv()),
    fs: realFs,
    preload: path.join(import.meta.dirname, "stryker-preload.ts"),
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  };
}
