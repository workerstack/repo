import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, expect } from "vitest";

import { put, tempDir, useTempDirs } from "../../sync/__fixtures__/temp-dirs.ts";
import { bunPath } from "../../../dev/test-paths";
import { childEnv } from "../../env.ts";
import { runDoctor as runDoctorImpl } from "../doctor.ts";
import { globalsRow } from "../doctor-rows.ts";
import type { DoctorResult } from "../doctor.types.ts";

export const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const script = fileURLToPath(new URL("../../../bin/repo.ts", import.meta.url));

const tmpDirs: string[] = [];
useTempDirs();
/** The skill packs the next `runDoctor` call sees as `agents.skills`. */
let skills: readonly string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { force: true, recursive: true });
  skills = [];
});

export function tmp(prefix: string): string {
  return tempDir(prefix);
}

/** A temp dir under its real path (macOS links the temp root), removed after the case. */
export function realTmp(prefix: string): string {
  return fs.realpathSync(tempDir(prefix));
}

export { put };

/** Removes `dir` after the case, for a path the case made itself. */
export function cleanLater(dir: string): void {
  tmpDirs.push(dir);
}

export function runDoctor(opts: Record<string, unknown> = {}): DoctorResult {
  return runDoctorImpl({ env: {}, home: path.join(os.tmpdir(), "repo-doctor-no-speak"), skills, ...opts });
}

export function enablePacks(packs = ["clasp", "google-workspace", "listen", "speak"]): void {
  skills = packs;
}

export function expectStdoutPath(stdout: string, abs: string): void {
  expect(stdout.toLowerCase()).toContain(abs.toLowerCase());
}

export function writeBin(dir: string, name: string, body = "#!/bin/sh\nexit 0\n"): string {
  fs.mkdirSync(dir, { recursive: true });
  if (process.platform === "win32") {
    const dest = path.join(dir, `${name}.cmd`);
    fs.writeFileSync(dest, "@echo off\r\nexit /b 0\r\n");
    return dest;
  }
  const dest = path.join(dir, name);
  fs.writeFileSync(dest, body, { mode: 0o755 });
  return dest;
}

export function writeBun(dir: string, version = "1.4.4"): string {
  if (process.platform === "win32") {
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, "bun.cmd");
    fs.writeFileSync(dest, `@echo off\r\nif "%~1"=="--version" echo ${version}\r\nexit /b 0\r\n`);
    return dest;
  }
  return writeBin(dir, "bun", `#!/bin/sh\n[ "$1" = "--version" ] && echo ${version} && exit 0\nexit 0\n`);
}

export const REQUIRED = ["bun", "git", "rtk", "lightpanda", "chromium"];

export function writeRequired(dir: string, extra: Record<string, string> = {}): void {
  writeBun(dir);
  writeBin(dir, "git");
  writeBin(dir, "rtk");
  writeBin(dir, extra.lightpandaName || "lightpanda");
  writeBin(dir, extra.chromiumName || "chromium");
}

/** A checkout with every required tool in its `bin/`. */
export function toolsCwd(prefix: string): { cwd: string; bin: string } {
  const cwd = tmp(prefix);
  const bin = path.join(cwd, "bin");
  writeRequired(bin);
  return { bin, cwd };
}

/** `runDoctor` on linux with `bin` as PATH and `home`, when given. */
export function linuxRun(cwd: string, bin: string, opts: Record<string, unknown> = {}): DoctorResult {
  return runDoctor({ cwd, pathEnv: bin, platform: "linux", ...opts });
}

/** A fresh home holding `files` (path parts joined by `/`, JSON bodies). */
export function homeWith(prefix: string, files: Record<string, unknown>): string {
  const home = tmp(prefix);
  for (const [rel, body] of Object.entries(files)) {
    const file = path.join(home, ...rel.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(body));
  }
  return home;
}

export const BOTH_MARKERS = [
  "# Index",
  "<!-- repo:skills -->",
  "<!-- /repo:skills -->",
  "<!-- repo:refs -->",
  "<!-- /repo:refs -->",
  "<!-- repo:stack -->",
  "<!-- /repo:stack -->",
  "",
].join("\n");

export function writeSelfPackage(cwd: string, name = "@workerstack/repo"): void {
  fs.mkdirSync(cwd, { recursive: true });
  fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ name }));
}

export function writeRequiredMaps(cwd: string, index = BOTH_MARKERS): void {
  writeSelfPackage(cwd);
  fs.mkdirSync(path.join(cwd, "references"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "references", "INDEX.md"), index);
}

/** A workspace skill `parent` and its packaged twin, with these bodies. */
export function writeSkillPair(cwd: string, workspace: string, packaged: string): void {
  const wsSkill = path.join(cwd, ".agents", "skills", "parent");
  const pkgSkill = path.join(cwd, "node_modules", "@workerstack", "repo", "agents", "skills", "parent");
  fs.mkdirSync(wsSkill, { recursive: true });
  fs.mkdirSync(pkgSkill, { recursive: true });
  fs.writeFileSync(path.join(wsSkill, "SKILL.md"), workspace);
  fs.writeFileSync(path.join(pkgSkill, "SKILL.md"), packaged);
}

/** A checkout with a copy of the stock globals and a grok config, and a run that computes the row as main() does. */
export function globalsSetup() {
  const cwd = tmp("doc-globals-");
  fs.cpSync(path.join(here, "..", "..", "agents/global-settings"), path.join(cwd, "agents/global-settings"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(cwd, ".grok"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".grok/config.toml"), "[plugins]\nenabled = []\n");
  const bin = path.join(cwd, "bin");
  writeRequired(bin);
  const home = tmp("doc-globals-home-");
  // as main() does: the row is computed first, then printed among the others
  const run = async () =>
    runDoctor({ cwd, globals: await globalsRow(cwd, home, { sourceRoot: cwd }), home, pathEnv: bin, platform: "linux" });
  return { cwd, home, run };
}

/** `bun bin/repo.ts doctor` in `cwd` with this env. */
export function doctorCli(cwd: string, env: Record<string, string>) {
  return spawnSync(bunPath(), [script, "doctor"], { cwd, encoding: "utf8", env: childEnv(env), timeout: 15_000 });
}
