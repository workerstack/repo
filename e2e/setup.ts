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
import { isRecord } from "./json";
import { packRepo, publish, retagTarball, startRegistry } from "./registry";

export const OLD_VERSION = "0.0.0-e2e.0";
/** The last commit whose init copies the agent trees into a consumer; its build is published as OLD_VERSION. */
export const OLD_COMMIT = "e7d680e";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

declare module "vitest" {
  export interface ProvidedContext {
    registryUrl: string;
    version: string;
    oldVersion: string;
    runRoot: string;
  }
}

function tarballVersion(tarball: string): string {
  let raw = "";
  tar.t({
    file: tarball,
    sync: true,
    filter: (p) => p === "package/package.json",
    onReadEntry: (entry) => entry.on("data", (c: Buffer) => (raw += c.toString("utf8"))),
  });
  if (!raw) throw new Error(`no package/package.json in ${tarball}`);
  const pkg = JSON.parse(raw);
  if (!isRecord(pkg) || typeof pkg.version !== "string") throw new Error(`no version in ${tarball}'s package.json`);
  return pkg.version;
}

/**
 * Builds, then packs this checkout. The build lives only here: packRepo skips prepack, and retagTarball re-packs
 * an extracted tarball that has no sources to build.
 */
function buildAndPack(dest: string): string {
  const r = spawnSync("bun", ["run", "build"], { cwd: repoRoot, encoding: "utf8", shell: process.platform === "win32" });
  // tsc prints its diagnostics on stdout.
  if (r.status !== 0) throw new Error(`bun run build failed:\n${r.stderr}${r.stdout}`);
  return packRepo(repoRoot, dest);
}

/** Builds OLD_COMMIT from `git archive` the way its own prepack does, and returns its tarball retagged as OLD_VERSION. */
function buildOld(work: string): string {
  const src = path.join(work, "old-src");
  const archive = path.join(work, "old-src.tar");
  const packDir = path.join(work, "old-pack");
  fs.mkdirSync(src, { recursive: true });
  fs.mkdirSync(packDir, { recursive: true });
  const sh = (cmd: string, args: string[]) => {
    const r = spawnSync(cmd, args, { cwd: cmd === "git" ? repoRoot : src, encoding: "utf8", shell: process.platform === "win32" });
    if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (is ${OLD_COMMIT} fetched?):\n${r.stderr}${r.stdout}`);
  };
  sh("git", ["archive", "-o", archive, OLD_COMMIT]);
  tar.x({ file: archive, cwd: src, sync: true });
  sh("bun", ["install", "--ignore-scripts"]);
  sh("bun", ["run", "build"]);
  return retagTarball(packRepo(src, packDir), OLD_VERSION, work);
}

export default async function setup(project: TestProject) {
  const parent = process.env.REPO_E2E_ROOT || os.tmpdir();
  fs.mkdirSync(parent, { recursive: true });
  const runRoot = fs.realpathSync(fs.mkdtempSync(path.join(parent, "repo-e2e-")));
  const given = process.env.REPO_E2E_TARBALL;
  const tarball = given ? path.resolve(given) : buildAndPack(runRoot);
  const version = tarballVersion(tarball);

  const reg = await startRegistry(path.join(runRoot, "registry"));
  publish(reg, buildOld(runRoot), "old");
  publish(reg, tarball, "latest");

  project.provide("registryUrl", reg.url);
  project.provide("version", version);
  project.provide("oldVersion", OLD_VERSION);
  project.provide("runRoot", runRoot);

  return async () => {
    await reg.close();
    if (!process.env.REPO_E2E_KEEP) fs.rmSync(runRoot, { recursive: true, force: true });
    else process.stdout.write(`kept e2e run root: ${runRoot}\n`);
  };
}
