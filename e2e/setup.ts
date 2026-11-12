/**
 * Global setup: pack (or take REPO_E2E_TARBALL), publish to a local registry as
 * `latest`, plus a real older build (the copying init of OLD_COMMIT) as `old` for the migration path.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as tar from "tar";
import type { TestProject } from "vitest/node";

import { repoEnv } from "../cli/repo-env.ts";
import { isRecord } from "./json";
import { packRepo, publish, type Registry, retagTarball, startRegistry } from "./registry";

export const OLD_VERSION = "0.0.0-e2e.0";

/** The last commit whose init copies the agent trees into a consumer; its build is published as OLD_VERSION. */
export const OLD_COMMIT = "e7d680e";

declare module "vitest" {
  export interface ProvidedContext {
    registryUrl: string;
    version: string;
    oldVersion: string;
    runRoot: string;
  }
}

/** This checkout: the parent of the e2e dir. */
function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function tarballVersion(tarball: string): string {
  let raw = "";
  tar.t({
    file: tarball,
    filter: (p) => p === "package/package.json",
    onReadEntry: (entry) => entry.on("data", (c: Buffer) => (raw += c.toString("utf8"))),
    sync: true,
  });

  if (raw === "") throw new Error(`no package/package.json in ${tarball}`);
  const pkg = JSON.parse(raw);

  if (!isRecord(pkg) || typeof pkg.version !== "string") throw new Error(`no version in ${tarball}'s package.json`);

  return pkg.version;
}

/**
 * Builds, then packs this checkout. The build lives only here: packRepo skips prepack, and retagTarball re-packs
 * an extracted tarball that has no sources to build.
 */
function buildAndPack(dest: string): string {
  const r = spawnSync("bun", ["run", "build"], {
    cwd: repoRoot(),
    encoding: "utf8",
    shell: process.platform === "win32",
  });

  // tsc prints its diagnostics on stdout.
  if (r.status !== 0) throw new Error(`bun run build failed:\n${r.stderr}${r.stdout}`);

  return packRepo(repoRoot(), dest);
}

/**
 * Builds OLD_COMMIT from `git archive` the way its own prepack does, and returns its tarball retagged as
 * OLD_VERSION.
 */
function buildOld(work: string): string {
  const src = path.join(work, "old-src");
  const archive = path.join(work, "old-src.tar");
  const packDir = path.join(work, "old-pack");
  fs.mkdirSync(src, { recursive: true });
  fs.mkdirSync(packDir, { recursive: true });

  function sh(cmd: string, args: string[]) {
    const r = spawnSync(cmd, args, {
      cwd: cmd === "git" ? repoRoot() : src,
      encoding: "utf8",
      shell: process.platform === "win32",
    });

    if (r.status !== 0)
      throw new Error(`${cmd} ${args.join(" ")} failed (is ${OLD_COMMIT} fetched?):\n${r.stderr}${r.stdout}`);
  }

  sh("git", ["archive", "-o", archive, OLD_COMMIT]);
  tar.x({ cwd: src, file: archive, sync: true });
  sh("bun", ["install", "--ignore-scripts"]);
  sh("bun", ["run", "build"]);

  return retagTarball(packRepo(src, packDir), OLD_VERSION, work);
}

/**
 * The run root's parent and whether the teardown removes it. The Actions runner empties its temp dir after the job
 * so there the root is left to it: removing a shard's sandboxes ourselves blocked the teardown for 119s on Windows
 * (run 42954496882).
 */
function runParent(): { parent: string; remove: boolean } {
  const { REPO_E2E_ROOT, RUNNER_TEMP } = repoEnv.process;

  if (REPO_E2E_ROOT !== undefined && REPO_E2E_ROOT !== "") return { parent: REPO_E2E_ROOT, remove: true };

  if (RUNNER_TEMP !== undefined && RUNNER_TEMP !== "") return { parent: RUNNER_TEMP, remove: false };

  return { parent: os.tmpdir(), remove: true };
}

export async function setup(project: TestProject) {
  const { parent, remove } = runParent();
  fs.mkdirSync(parent, { recursive: true });
  // `.native` expands an 8.3 name (`RUNNER~1`) to the long one; plain `realpathSync` keeps it, and then one dir is
  // two module paths to the nested vitest and its test files, which fails "find the current suite".
  const runRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(parent, "repo-e2e-")));
  let reg: Registry | undefined;

  // One cleanup for the teardown and for a failed setup: stop the registry, then drop the run root.
  async function cleanup() {
    try {
      await reg?.close();
    } finally {
      if ((repoEnv.process.REPO_E2E_KEEP ?? "") !== "") process.stdout.write(`kept e2e run root: ${runRoot}\n`);
      else if (remove) fs.rmSync(runRoot, { force: true, recursive: true });
    }
  }

  try {
    const given = repoEnv.process.REPO_E2E_TARBALL ?? "";
    const tarball = given === "" ? buildAndPack(runRoot) : path.resolve(given);
    const version = tarballVersion(tarball);

    reg = await startRegistry(path.join(runRoot, "registry"));
    publish(reg, buildOld(runRoot), "old");
    publish(reg, tarball, "latest");

    project.provide("registryUrl", reg.url);
    project.provide("version", version);
    project.provide("oldVersion", OLD_VERSION);
    project.provide("runRoot", runRoot);
  } catch (err) {
    await cleanup();
    throw err;
  }

  return cleanup;
}
