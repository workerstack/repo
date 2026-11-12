import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { readJsonFile } from "../package-json.ts";
import type { Runner } from "../scripts/ci-wait.ts";
import {
  BUN_ADD,
  BUN_ADD_FROM,
  INSTALLED_DIR,
  NPM_ALIAS,
  OLD_ALIAS,
  PROJECT_FILE,
  PROJECT_MANIFEST,
  ROOT_KEY,
  TARBALL_ALIAS,
} from "./consumer.constants.ts";
import type { Subpath } from "./exports.ts";

/** What installing needs: a `bun` that runs in a directory. */
export type InstallIo = { bun: Runner };

/** A package installed in a project: the name it is imported by, its directory and its package.json as installed. */
export type Package = { name: string; root: string; installed: Installed };

/** The fields of an installed package.json the checks read. */
type Installed = { version: string; exports?: unknown; peerDependencies: Record<string, string> };

/** Where the old version comes from: a registry (name, version, registry URL) or a tarball on disk. */
export type OldSpec = { name: string; version: string; registry: string } | { tarball: string };

function installedSchema(): z.ZodType<Installed> {
  return z.object({
    exports: z.unknown().optional(),
    peerDependencies: z.record(z.string(), z.string()).default({}),
    version: z.string(),
  });
}

function projectSchema() {
  return z.object({ dependencies: z.record(z.string(), z.string()) });
}

function firstLine(text: string): string {
  return text.trim().split("\n", 1).join("");
}

/** Writes the manifest of an empty project into `project`. */
export function initProject(project: string): void {
  fs.writeFileSync(path.join(project, PROJECT_FILE), PROJECT_MANIFEST);
}

/** Runs `bun add` of `specs` in `project`; bun's stderr when it fails, else null. */
export function addSpecs(project: string, specs: readonly string[], io: InstallIo): string | null {
  const added = io.bun(BUN_ADD(...specs), project);

  return added.code === 0 ? null : added.stderr.trim();
}

/** The name of the one package added to `project`. */
export function addedName(project: string): string {
  return Object.keys(readJsonFile(path.join(project, PROJECT_FILE), projectSchema()).dependencies).join("");
}

/** The package `name` as installed in `project`, which can hold several. */
export function installedIn(project: string, name: string): Package {
  const root = path.join(project, INSTALLED_DIR, name);

  return { installed: readJsonFile(path.join(root, PROJECT_FILE), installedSchema()), name, root };
}

/** Adds the peers bun leaves out (the optional ones); bun's stderr when that fails, else null. */
export function addPeers(project: string, pkg: Package, io: InstallIo): string | null {
  const peers = Object.entries(pkg.installed.peerDependencies).map(([peer, range]) => `${peer}@${range}`);

  return peers.length === 0 ? null : addSpecs(project, peers, io);
}

/** Adds the old version to `project` as `old`; the first line of bun's error when it fails, else null. */
export function installOld(project: string, spec: OldSpec, io: InstallIo): string | null {
  const args =
    "tarball" in spec
      ? BUN_ADD(TARBALL_ALIAS(spec.tarball))
      : BUN_ADD_FROM(spec.registry, NPM_ALIAS(spec.name, spec.version));

  const added = io.bun(args, project);

  return added.code === 0 ? null : firstLine(added.stderr);
}

/** The specifier a package installed as `name` is imported by at one of its subpaths. */
export function specOf(name: string, subpath: Subpath): string {
  return `${name}${subpath.key.slice(ROOT_KEY.length)}`;
}

/**
 * Names the old copy `old` in its own package.json: TypeScript treats two packages of one name and version as one
 * package and reads the first for both, and the old version usually has the checkout's own name and version.
 */
export function renameOld(project: string): void {
  const file = path.join(project, INSTALLED_DIR, OLD_ALIAS, PROJECT_FILE);
  const manifest = readJsonFile(file, z.record(z.string(), z.unknown()));
  fs.writeFileSync(file, JSON.stringify({ ...manifest, name: OLD_ALIAS }));
}
