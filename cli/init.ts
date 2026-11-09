import { execFileSync } from "./spawn.ts";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_FILE, HOSTS, SKILL_PACKS, defaultPacks } from "./config.ts";
import { PRINT_WIDTH } from "./sync/standards.ts";
import { PACKAGE_NAME } from "./sync/stock.ts";

export { PACKAGE_NAME };

const PKG_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The `repo:*` scripts older inits copied into a consumer, with every value they wrote: init removes one still equal to one of them. */
const OLD_DEFAULT_SCRIPTS: Record<string, readonly string[]> = {
  "repo:build": ["tsc -p tsconfig.build.json"],
  "repo:prepack": ["bun run build"],
  "repo:rulesync:generate": [
    "bun ./.rulesync/scripts/guarded-roots.ts generate",
    "node ./.rulesync/scripts/guarded-roots.mjs generate",
    "node ./scripts/guarded-roots.mjs generate",
    "rulesync generate -t claudecode,codexcli,antigravity-cli,grokcli -f rules,subagents,skills && rulesync generate -t claudecode,codexcli,antigravity-cli -f hooks && node scripts/emit-mcp-policy.mjs && node scripts/emit-gemini.mjs && node scripts/emit-agent-shell-tools.mjs && node scripts/hooks-union.mjs",
    "rulesync generate -t claudecode,codexcli,antigravity-cli,grokcli -f rules,subagents && rulesync generate -t claudecode,codexcli,antigravity-cli -f hooks && node scripts/emit-mcp-policy.mjs",
  ],
  "repo:rulesync:watch": [
    "bun ./.rulesync/scripts/guarded-roots.ts watch",
    "node ./.rulesync/scripts/guarded-roots.mjs watch",
    "node ./scripts/guarded-roots.mjs watch",
    "node scripts/emit-mcp-policy.mjs && node scripts/emit-gemini.mjs && node scripts/emit-agent-shell-tools.mjs && rulesync generate -t claudecode,codexcli,antigravity-cli,grokcli -f rules,subagents,skills --watch",
    "node scripts/emit-mcp-policy.mjs && rulesync generate -t claudecode,codexcli,antigravity-cli,grokcli -f rules,subagents --watch",
  ],
  "repo:rulesync:check": [
    "bun ./.rulesync/scripts/guarded-roots.ts check",
    "node ./.rulesync/scripts/guarded-roots.mjs check",
    "node ./scripts/guarded-roots.mjs check",
    "rulesync generate -t claudecode,codexcli,antigravity-cli,grokcli -f rules,skills --check && rulesync generate -t codexcli,antigravity-cli,grokcli -f subagents --check && rulesync generate -t claudecode,codexcli,antigravity-cli -f hooks --check && node scripts/emit-mcp-policy.mjs --check && node scripts/emit-gemini.mjs --check && node scripts/emit-agent-shell-tools.mjs --check && node scripts/check-globals.mjs && node scripts/hooks-union.mjs --check",
    "rulesync generate -t claudecode,codexcli,antigravity-cli,grokcli -f rules,subagents --check && rulesync generate -t claudecode,codexcli,antigravity-cli -f hooks --check && node scripts/emit-mcp-policy.mjs --check && node scripts/check-globals.mjs",
  ],
  "repo:hooks:union": [
    "bun .rulesync/scripts/hooks-union.ts",
    "node .rulesync/scripts/hooks-union.mjs",
    "node scripts/hooks-union.mjs",
  ],
  "repo:hooks:check": [
    "bun .rulesync/scripts/hooks-union.ts --check",
    "node .rulesync/scripts/hooks-union.mjs --check",
    "node scripts/hooks-union.mjs --check",
  ],
  "repo:doctor": [
    "repo doctor",
    "bun ./.rulesync/scripts/doctor.ts",
    "node ./.rulesync/scripts/doctor.mjs",
    "node ./scripts/doctor.mjs",
  ],
  "repo:clean": ["repo clean", "bun ./.rulesync/scripts/clean.ts", "node ./.rulesync/scripts/clean.mjs"],
  "repo:setup": [
    "repo setup",
    "bun ./.rulesync/scripts/setup.ts",
    "node ./.rulesync/scripts/setup.mjs",
    "node ./scripts/setup.mjs",
  ],
  "repo:tasks": ["repo tasks", "bun .rulesync/scripts/vscode-tasks.ts", "node .rulesync/scripts/vscode-tasks.mjs"],
  "repo:rulesync:doctor": ["rulesync doctor"],
  "repo:sync:globals": [
    "repo sync-globals",
    "bun .rulesync/scripts/sync-global-settings.ts",
    "node .rulesync/scripts/sync-global-settings.mjs",
    "node scripts/sync-global-settings.mjs",
  ],
  "repo:sync:globals:check": [
    "bun .rulesync/scripts/check-globals.ts",
    "node .rulesync/scripts/check-globals.mjs",
    "node scripts/check-globals.mjs",
  ],
  "repo:sync:globals:apply": [
    "repo sync-globals --apply",
    "bun .rulesync/scripts/sync-global-settings.ts --apply",
    "node .rulesync/scripts/sync-global-settings.mjs --apply",
    "node scripts/sync-global-settings.mjs --apply",
  ],
  "repo:purge:global-mcps": [
    "repo purge-mcps",
    "bun .rulesync/scripts/purge-global-mcps.ts",
    "node .rulesync/scripts/purge-global-mcps.mjs",
    "node scripts/purge-global-mcps.mjs",
  ],
  "repo:purge:global-mcps:apply": [
    "repo purge-mcps --apply",
    "bun .rulesync/scripts/purge-global-mcps.ts --apply",
    "node .rulesync/scripts/purge-global-mcps.mjs --apply",
    "node scripts/purge-global-mcps.mjs --apply",
  ],
  "repo:typecheck": ["tsc -p ."],
  "repo:test:e2e": ["vitest run -c vitest.e2e.config.ts"],
  "repo:antigravity": ["antigravity --dangerously-skip-permissions"],
  "repo:claude": ["claude --dangerously-skip-permissions"],
  "repo:codex": ["codex --dangerously-bypass-approvals-and-sandbox"],
  "repo:gemini": ["gemini --yolo"],
  "repo:grok": ["grok --yolo"],
};

function sortKeys<T>(obj: Record<string, T>): Record<string, T> {
  // k comes from Object.keys(obj), so it is always present
  return Object.fromEntries(
    Object.keys(obj)
      .sort()
      .map((k) => [k, obj[k]!]),
  );
}

export function samePath(a: string, b: string) {
  try {
    return fs.realpathSync.native(a) === fs.realpathSync.native(b);
  } catch {
    return path.resolve(a) === path.resolve(b);
  }
}

/** The slice of package.json init reads; other keys pass through. */
interface PackageJson {
  name?: string;
  version?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [key: string]: unknown;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isStringRecord(v: unknown): v is Record<string, string> {
  return isRecord(v) && Object.values(v).every((x) => typeof x === "string");
}

/** True when name and version are strings and the script and dependency maps hold only strings. */
function isPackageJson(v: unknown): v is PackageJson {
  return (
    isRecord(v) &&
    [v.name, v.version].every((x) => x === undefined || typeof x === "string") &&
    [v.scripts, v.dependencies, v.devDependencies].every((x) => x === undefined || isStringRecord(x))
  );
}

/** The JSON file at `file`, refused with a clear error unless `is` accepts its shape. */
function readJsonFile<T>(file: string, is: (v: unknown) => v is T): T {
  const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!is(value)) throw new Error(`${file} does not hold the shape repo needs`);
  return value;
}

export function placeDevDependency(destPkg: PackageJson, srcPkg?: PackageJson) {
  const deps = destPkg.dependencies && typeof destPkg.dependencies === "object" ? destPkg.dependencies : null;
  const devDeps: Record<string, string> = { ...(destPkg.devDependencies || {}) };
  destPkg.devDependencies = devDeps;
  const fromDep = deps?.[PACKAGE_NAME];
  const fromDev = devDeps[PACKAGE_NAME];
  if (fromDep != null && deps) {
    delete deps[PACKAGE_NAME];
    if (fromDev == null) devDeps[PACKAGE_NAME] = fromDep;
    if (Object.keys(deps).length === 0) delete destPkg.dependencies;
  }
  if (devDeps[PACKAGE_NAME] == null && srcPkg?.name === PACKAGE_NAME && srcPkg.version) {
    devDeps[PACKAGE_NAME] = srcPkg.version;
  }
}

/** The skill packs of a `--packs` list (comma separated, `none` or empty for no packs), once each in `SKILL_PACKS` order; an unknown name throws. */
export function parsePacksFlag(value: string): string[] {
  const text = value.trim();
  if (!text || text === "none") return [];
  const names = text
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  for (const name of names) {
    if (!SKILL_PACKS.some((pack) => pack === name)) throw new Error(`unknown pack ${name}`);
  }
  return SKILL_PACKS.filter((pack) => names.includes(pack));
}

const SYNC_POSTINSTALL = "repo sync --postinstall";

/** Write `workerstack.config.ts`, formatted as oxfmt would, with the default packs (agents, standards and docs), every host and the chosen skill packs, only when the repo has no config. */
export function writeConfigIfMissing(dest: string, skills: readonly string[] = []) {
  const configPath = path.join(dest, CONFIG_FILE);
  if (fs.existsSync(configPath)) return;
  const list = (names: readonly string[]) => names.map((n) => JSON.stringify(n)).join(", ");
  const keys = [`hosts: [${list(HOSTS)}]`, ...(skills.length > 0 ? [`skills: [${list(skills)}]`] : [])];
  // Laid out as the standards pack's oxfmt would: one line while it fits the width, else one key per line.
  const inline = `  agents: { ${keys.join(", ")} },`;
  const agents =
    inline.length <= PRINT_WIDTH ? inline : `  agents: {\n${keys.map((key) => `    ${key},\n`).join("")}  },`;
  fs.writeFileSync(
    configPath,
    `import { defineConfig } from "${PACKAGE_NAME}";\n\nexport default defineConfig({\n  packs: [${list(defaultPacks())}],\n${agents}\n});\n`,
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
 * package.json, default `private`, `sideEffects` and `packageManager` when absent, and drop the `repo:*` scripts an older init copied while they still hold a value it wrote.
 */
export function mergePackageJson(dest: string, pkgRoot: string) {
  const destPath = path.join(dest, "package.json");
  let destPkg: PackageJson = {};
  if (fs.existsSync(destPath)) {
    destPkg = readJsonFile(destPath, isPackageJson);
  }
  if (destPkg.name === PACKAGE_NAME) return;

  const srcPkg = readJsonFile(path.join(pkgRoot, "package.json"), isPackageJson);
  const destScripts: Record<string, string> = { ...(destPkg.scripts || {}) };
  for (const [name, value] of Object.entries(destScripts)) {
    if (OLD_DEFAULT_SCRIPTS[name]?.includes(value)) delete destScripts[name];
  }
  const postinstall = destScripts.postinstall;
  if (postinstall == null) destScripts.postinstall = SYNC_POSTINSTALL;
  else if (!postinstall.includes("repo sync")) destScripts.postinstall = `${SYNC_POSTINSTALL} && ${postinstall}`;
  placeDevDependency(destPkg, srcPkg);
  defaultManifestKeys(destPkg);
  destPkg.scripts = sortKeys(destScripts);
  destPkg.devDependencies = sortKeys(destPkg.devDependencies!);
  fs.writeFileSync(destPath, `${JSON.stringify(destPkg, null, 2)}\n`);
}

export interface InitOptions {
  pkgRoot?: string;
  execFileSync?: (cmd: string, args: string[], opts: import("node:child_process").ExecFileSyncOptions) => unknown;
  skipGlobals?: boolean;
  onPhase?: (name: string, state: "start" | "stop") => void;
  /** Skill packs written as `agents.skills` into a new config. */
  packs?: string[];
}

/**
 * Write the config and package.json entries a repo needs, install, and apply the global settings. The agent
 * trees are not copied: the postinstall of `bun install` runs `repo sync`, which generates them.
 * @param dest Workspace to initialise.
 * @param [options]
 * @returns
 */
export function init(
  dest: string,
  { pkgRoot: pkgRootOpt, execFileSync: exec = execFileSync, skipGlobals = false, onPhase, packs }: InitOptions = {},
): void {
  dest = path.resolve(dest);
  const pkgRoot = path.resolve(pkgRootOpt ?? PKG_ROOT);
  // This package is its own workspace: nothing to write, install or apply.
  if (samePath(dest, pkgRoot)) return;

  onPhase?.("merge", "start");
  try {
    mergePackageJson(dest, pkgRoot);
    writeConfigIfMissing(dest, packs);
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
