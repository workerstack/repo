#!/usr/bin/env bun
// The `repo` command `repo shim` installs: runs the nearest project's own @workerstack/repo from any directory below
// it. Plain JS with no imports beyond node: and no types, so the installed copy is this file byte for byte.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ENTRY = path.join("node_modules", "@workerstack", "repo", "bin", "repo.ts");

/** The first `bin/repo.ts` of an installed @workerstack/repo in `cwd` or a parent, or null. */
export function findLocalRepo(cwd) {
  let dir = path.resolve(cwd);

  for (;;) {
    const candidate = path.join(dir, ENTRY);

    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);

    if (parent === dir) return null;
    dir = parent;
  }
}

/** Runs the project's repo with `args` here; its exit code, or 1 with a message when there is none. */
export function run(args, cwd) {
  const entry = findLocalRepo(cwd);

  if (entry === null) {
    process.stderr.write(`repo: no @workerstack/repo found above ${cwd}; run \`bun install\` in the project\n`);

    return 1;
  }

  return spawnSync(process.execPath, [entry, ...args], { cwd, stdio: "inherit" }).status ?? 1;
}

if (import.meta.main) process.exit(run(process.argv.slice(2), process.cwd()));
