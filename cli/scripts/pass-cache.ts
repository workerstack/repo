/**
 * Turn's and precommit's pass cache: each step a passing gate ran is recorded under a key of everything the step
 * reads, so a later gate skips it. A key is the step's name, the HEAD commit, the working tree's state tree, the gated
 * files and the gate's env; an entry is an empty file under `.repo/tmp/turn` named by it.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { dependencyNames } from "../dependency-names.ts";
import { childEnv } from "../env.ts";
import { MARKER_FILE, MODULES } from "../link.constants.ts";
import { readJsonFile } from "../package-json.ts";
import { removeTree } from "../remove-tree.ts";
import { REPO, STATE } from "../repo-dirs.ts";
import { packageJsonSchema } from "../sync/workspace.ts";
import type { PackageJson, Workspace } from "../sync/workspace.ts";
import type { Change } from "./change-set.ts";
import { INDEX_TEMP_PREFIX, NO_HEAD, PASS_AGE, PASS_DIR } from "./pass-cache.constants.ts";
import { MANIFEST_FILE } from "./turn-steps.constants.ts";

/** This package's own dir, whose dependencies run the steps. */
const OWN_DIR = /* @__PURE__ */ path.join(import.meta.dirname, "../..");

/** git's trimmed stdout in `root`; throws when git fails. */
function git(root: string, args: string[], env?: Record<string, string>): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", env, stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * The tree `git add -A` would stage now, written from a copy of the index so the real one is left alone; null when
 * git cannot stage the tree, as for an unreadable file. The copy's dir is removed on every exit.
 */
function stateTree(root: string): string | null {
  const source = path.resolve(root, git(root, ["rev-parse", "--git-path", "index"]));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), INDEX_TEMP_PREFIX));

  try {
    const copy = path.join(dir, "index");

    const stat = fs.statSync(source, { throwIfNoEntry: false });

    if (stat !== undefined) {
      fs.copyFileSync(source, copy);
      // Git rereads a file changed in the same second as the index was written; a newer copy would trust its stat.
      fs.utimesSync(copy, stat.atime, stat.mtime);
    }

    const env = childEnv({ GIT_INDEX_FILE: copy });

    git(root, ["add", "-A"], env);

    return git(root, ["write-tree"], env);
  } catch {
    return null;
  } finally {
    removeTree(dir);
  }
}

/** The HEAD commit, or `none` before the first commit. */
function headCommit(root: string): string {
  try {
    return git(root, ["rev-parse", "--verify", "-q", "HEAD"]);
  } catch {
    return NO_HEAD;
  }
}

/** The installed dir of `name` seen from `dir`, as node finds it: the nearest `node_modules` above that holds it. */
function installedDir(dir: string, name: string): string | null {
  for (let at = dir; ; at = path.dirname(at)) {
    const candidate = path.join(at, MODULES, name);

    if (fs.existsSync(path.join(candidate, MANIFEST_FILE))) return candidate;

    if (path.dirname(at) === at) return null;
  }
}

/** What an install leaves for `name` seen from `dir`: its manifest's text and mtime and any link marker. */
function installed(dir: string, name: string): string {
  const at = installedDir(dir, name);

  if (at === null) return "missing";
  const manifest = path.join(at, MANIFEST_FILE);
  const marker = path.join(at, MARKER_FILE);
  const link = fs.existsSync(marker) ? fs.readFileSync(marker, "utf8") : "";

  return `${sha256(fs.readFileSync(manifest, "utf8"))} ${fs.statSync(manifest).mtimeMs} ${sha256(link)}`;
}

/** The ignored files outside an ignored dir and outside `.repo`: `.env` files and generated tool configs. */
function ignoredFiles(root: string): string[] {
  return git(root, ["ls-files", "-o", "-i", "--exclude-standard", "--directory", "-z"])
    .split("\0")
    .filter((rel) => rel !== "" && !rel.endsWith("/") && !rel.startsWith(`${REPO}/`))
    .toSorted();
}

/**
 * One ignored file's part of the env: its bytes' hash, or a link's target, since git lists a link to a dir (a host's
 * linked skill) as a file, which reading would follow into the dir.
 */
function ignoredKey(file: string): string {
  return fs.lstatSync(file).isSymbolicLink() ? `-> ${fs.readlinkSync(file)}` : sha256(fs.readFileSync(file, "utf8"));
}

function nodeVersion(): string {
  const run = spawnSync("node", ["--version"], { encoding: "utf8" });

  return run.status === 0 ? run.stdout.trim() : "none";
}

/**
 * What a gate reads beyond the tree: the bun and node versions, each dependency the root, its packages and this
 * package declare as installed, and the ignored files outside ignored dirs.
 */
function gateEnv(workspace: Workspace): string {
  const dirs = new Map<string, PackageJson>([
    [OWN_DIR, readJsonFile(path.join(OWN_DIR, MANIFEST_FILE), packageJsonSchema)],
    [workspace.root, workspace.manifest],
  ]);

  for (const pkg of workspace.packages) dirs.set(path.join(workspace.root, pkg.dir), pkg.manifest);
  const lines = [`bun ${Bun.version}`, `node ${nodeVersion()}`];

  for (const [dir, manifest] of dirs)
    for (const name of dependencyNames(manifest)) lines.push(`${dir} ${name} ${installed(dir, name)}`);

  for (const rel of ignoredFiles(workspace.root)) lines.push(`${rel} ${ignoredKey(path.join(workspace.root, rel))}`);

  return sha256(lines.join("\n"));
}

/** A step's key over the gate's files, null with no state tree; `moved` reads the tree and env again after a step. */
type PassKeys = { key: (step: string, changes: readonly Change[]) => string | null; moved: () => void };

/**
 * The key of a step over the gate's files as they are now, or null when the state tree could not be written; `moved`
 * reads the tree and env again after a step ran, since a step can write any file, ignored ones included.
 */
export function passKeys(workspace: Workspace): PassKeys {
  const { root } = workspace;
  const head = headCommit(root);
  let tree = stateTree(root);
  let env = gateEnv(workspace);

  return {
    key: (step, changes) => {
      const files = changes.map((change) => [change.rel, change.deleted]);

      return tree === null ? null : sha256(JSON.stringify([step, head, tree, files, env]));
    },
    moved: () => {
      tree = stateTree(root);
      env = gateEnv(workspace);
    },
  };
}

function passDir(root: string): string {
  return path.join(root, REPO, STATE, PASS_DIR);
}

export function hasPass(root: string, key: string): boolean {
  return fs.existsSync(path.join(passDir(root), key));
}

/** Writes an entry for each key, then removes the entries older than `PASS_AGE`. */
export function recordPasses(root: string, keys: readonly string[], now: number = Date.now()): void {
  const dir = passDir(root);
  fs.mkdirSync(dir, { recursive: true });

  for (const key of keys) fs.writeFileSync(path.join(dir, key), "");

  for (const name of fs.readdirSync(dir)) {
    const entry = path.join(dir, name);
    // Another gate may have pruned it since the listing.
    const stat = fs.statSync(entry, { throwIfNoEntry: false });

    if (stat !== undefined && stat.mtimeMs < now - PASS_AGE) fs.rmSync(entry, { force: true });
  }
}
