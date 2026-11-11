import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CONFIG_FILE } from "./config.constants.ts";
import { HOSTS, SKILL_PACKS, defaultPacks } from "./config.ts";
import { initGit } from "./init-git.ts";
import { initMcpJson } from "./init-mcp-json.ts";
import { JSON_INDENT, NO_PACKS, OLD_DEFAULT_SCRIPTS, SYNC_COMMAND, SYNC_POSTINSTALL } from "./init.constants.ts";
import { PRINT_WIDTH } from "./lint/max-line-width.constants.ts";
import { isPackageJson, readJsonFile, type PackageJson } from "./package-json.ts";
import { placeDevDependency } from "./place-dev-dependency.ts";
import { captureTool } from "./scripts/lint.ts";
import { execFileSync } from "./spawn.ts";
import { PACKAGE_NAME } from "./sync/package-name.constants.ts";

/** This package's root, which init reads its version from. */
function builtInRoot(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
}

/** `obj` with its keys in code-unit order, as `Array#sort` orders them. */
function sortKeys<T>(obj: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(obj).toSorted(([a], [b]) => Number(a > b) - Number(a < b)));
}

export function samePath(a: string, b: string): boolean {
  try {
    return fs.realpathSync.native(a) === fs.realpathSync.native(b);
  } catch {
    return path.resolve(a) === path.resolve(b);
  }
}

/**
 * The skill packs of a `--packs` list (comma separated, `none` or empty for no packs), once each in `SKILL_PACKS`
 * order; an unknown name throws.
 */
export function parsePacksFlag(value: string): string[] {
  const text = value.trim();
  if (text === "" || text === NO_PACKS) return [];
  const names = text
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  for (const name of names) if (!SKILL_PACKS.some((pack) => pack === name)) throw new Error(`unknown pack ${name}`);

  return SKILL_PACKS.filter((pack) => names.includes(pack));
}

/** `names` as a JSON list body: each quoted, comma separated. */
function quoted(names: readonly string[]): string {
  return names.map((n) => JSON.stringify(n)).join(", ");
}

/**
 * Write `workerstack.config.ts`, formatted as oxfmt would, with the default packs (agents, standards and docs),
 * every host and the chosen skill packs, only when the repo has no config.
 */
export function writeConfigIfMissing(dest: string, skills: readonly string[] = []): void {
  const configPath = path.join(dest, CONFIG_FILE);
  if (fs.existsSync(configPath)) return;
  const keys = [`hosts: [${quoted(HOSTS)}]`, ...(skills.length > 0 ? [`skills: [${quoted(skills)}]`] : [])];
  // Laid out as the standards pack's oxfmt would: one line while it fits the width, else one key per line.
  const inline = `  agents: { ${keys.join(", ")} },`;
  const agents =
    inline.length <= PRINT_WIDTH ? inline : `  agents: {\n${keys.map((key) => `    ${key},\n`).join("")}  },`;
  fs.writeFileSync(
    configPath,
    `import { defineConfig } from "${PACKAGE_NAME}";\n\nexport default defineConfig({\n\
  packs: [${quoted(defaultPacks())}],\n${agents}\n});\n`,
  );
}

/** The root keys `repo check` requires; a value already there stays, even one check would fail. */
function defaultManifestKeys(pkg: PackageJson) {
  pkg.private ??= true;
  // A root with workspaces is not a package, so `repo check` does not ask it for sideEffects.
  if (pkg.workspaces === undefined) pkg.sideEffects ??= false;
  pkg.packageManager ??= `bun@${Bun.version}`;
}

/**
 * Put the postinstall that runs `repo sync` and the `@workerstack/repo` devDependency into the repo's
 * package.json, default `private`, `sideEffects` and `packageManager` when absent, and drop the `repo:*` scripts an
 * older init copied while they still hold a value it wrote.
 */
export function mergePackageJson(dest: string, pkgRoot: string): void {
  const destPath = path.join(dest, "package.json");
  let destPkg: PackageJson = {};
  if (fs.existsSync(destPath)) destPkg = readJsonFile(destPath, isPackageJson);

  if (destPkg.name === PACKAGE_NAME) return;

  const srcPkg = readJsonFile(path.join(pkgRoot, "package.json"), isPackageJson);
  const destScripts: Record<string, string> = { ...destPkg.scripts };
  for (const [name, value] of Object.entries(destScripts))
    if (OLD_DEFAULT_SCRIPTS[name]?.includes(value) === true) delete destScripts[name];

  const postinstall = destScripts.postinstall;
  if (postinstall == null) destScripts.postinstall = SYNC_POSTINSTALL;
  else if (!postinstall.includes(SYNC_COMMAND)) destScripts.postinstall = `${SYNC_POSTINSTALL} && ${postinstall}`;
  const devDeps = placeDevDependency(destPkg, srcPkg);
  defaultManifestKeys(destPkg);
  destPkg.scripts = sortKeys(destScripts);
  destPkg.devDependencies = sortKeys(devDeps);
  fs.writeFileSync(destPath, `${JSON.stringify(destPkg, null, JSON_INDENT)}\n`);
  formatManifest(dest);
}

/**
 * Has oxfmt order and lay out the manifest in `dest` as the standards config does (`sortPackageJson`, the print
 * width), so a new repo's first `repo fmt --check` leaves it alone. A failure leaves the file as written; `repo fmt`
 * fixes it.
 */
function formatManifest(dest: string): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-init-fmt-"));
  try {
    const config = path.join(dir, "oxfmt.json");
    fs.writeFileSync(config, JSON.stringify({ printWidth: PRINT_WIDTH, sortPackageJson: true }));
    captureTool("oxfmt", ["--config", config, "package.json"], dest);
  } finally {
    fs.rmSync(dir, { force: true, recursive: true });
  }
}

export type InitOptions = {
  pkgRoot?: string;
  execFileSync?: (cmd: string, args: string[], opts: import("node:child_process").ExecFileSyncOptions) => unknown;
  skipGlobals?: boolean;
  onPhase?: (name: string, state: "start" | "stop") => void;
  /** Skill packs written as `agents.skills` into a new config. */
  packs?: string[];
  /** Where init prints what it wrote; the process's stdout when omitted. */
  stdout?: (s: string) => void;
};

/**
 * Writes the package.json entries, the config and `.mcp.json` when missing, and runs `git init` outside a work
 * tree.
 */
function prepareDir(
  dest: string,
  pkgRoot: string,
  {
    packs,
    stdout,
    exec,
  }: {
    packs: string[] | undefined;
    stdout: ((s: string) => void) | undefined;
    exec: NonNullable<InitOptions["execFileSync"]>;
  },
): void {
  mergePackageJson(dest, pkgRoot);
  writeConfigIfMissing(dest, packs);
  initMcpJson(dest, stdout);
  initGit(dest, exec, stdout);
}

/**
 * Write the config and package.json entries a repo needs, install, and apply the global settings. The agent
 * trees are not copied: the postinstall of `bun install` runs `repo sync`, which generates them.
 * @param target Workspace to initialise.
 * @param [options]
 * @returns
 */
export function init(
  target: string,
  {
    pkgRoot: pkgRootOpt,
    execFileSync: exec = execFileSync,
    skipGlobals = false,
    onPhase,
    packs,
    stdout,
  }: InitOptions = {},
): void {
  const dest = path.resolve(target);
  const pkgRoot = path.resolve(pkgRootOpt ?? builtInRoot());
  // This package is its own workspace: nothing to write, install or apply.
  if (samePath(dest, pkgRoot)) return;

  onPhase?.("merge", "start");
  try {
    prepareDir(dest, pkgRoot, { exec, packs, stdout });
  } finally {
    onPhase?.("merge", "stop");
  }

  const bun = (name: string, args: string[]) => {
    onPhase?.(name, "start");
    onPhase?.(name, "stop");
    exec("bun", args, { cwd: dest, stdio: "inherit" });
  };
  bun("install", ["install"]);
  if (!skipGlobals) bun("yolo", ["repo", "yolo"]);
}
