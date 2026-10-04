/**
 * Global setup: pack (or take GRUNT_E2E_TARBALL), publish to a local registry as
 * `latest`, plus an older copy as `old` for the self-update path.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TestProject } from "vitest/node";
import { packRepo, publish, retagTarball, startRegistry } from "./registry";

export const OLD_VERSION = "0.0.1-e2e.0";

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
  const r = spawnSync("tar", ["-xOzf", tarball, "package/package.json"], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`cannot read package.json from ${tarball}:\n${r.stderr}`);
  return JSON.parse(r.stdout).version;
}

export default async function setup(project: TestProject) {
  const parent = process.env.GRUNT_E2E_ROOT || os.tmpdir();
  fs.mkdirSync(parent, { recursive: true });
  const runRoot = fs.realpathSync(fs.mkdtempSync(path.join(parent, "grunt-e2e-")));
  const given = process.env.GRUNT_E2E_TARBALL;
  const tarball = given ? path.resolve(given) : packRepo(repoRoot, runRoot);
  const version = tarballVersion(tarball);

  // pnpm and yarn come from corepack, pinned per consumer by its packageManager field.
  const bin = path.join(runRoot, "bin");
  fs.mkdirSync(bin);
  const corepack = spawnSync("corepack", ["enable", "--install-directory", bin, "pnpm", "yarn"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (corepack.status !== 0) throw new Error(`corepack enable failed:\n${corepack.stderr}`);

  const reg = await startRegistry(path.join(runRoot, "registry"));
  publish(reg, retagTarball(tarball, OLD_VERSION, runRoot), "old");
  publish(reg, tarball, "latest");

  project.provide("registryUrl", reg.url);
  project.provide("version", version);
  project.provide("oldVersion", OLD_VERSION);
  project.provide("runRoot", runRoot);

  return async () => {
    await reg.close();
    if (!process.env.GRUNT_E2E_KEEP) fs.rmSync(runRoot, { recursive: true, force: true });
    else process.stdout.write(`kept e2e run root: ${runRoot}\n`);
  };
}
