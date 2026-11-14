// The recorded copied install and the consumers the migrate suites run sync over, with typed file readers.
import { AGENT_DEFAULTS } from "../../agent-defaults.constants.ts";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as tar from "tar";
import { BASE_CONFIG } from "../../__fixtures__/base-config.ts";
import { HOSTS, loadConfig, type ResolvedConfig } from "../../config.ts";
import { runSync } from "../../sync.ts";
import { computeOutputs } from "../../sync-outputs.ts";
import { untrackedEntries } from "../git-files.ts";
import { applyMigration } from "../apply-migration.ts";
import { moveOldConfig } from "../migrate-config-name.ts";
import { planMigration, generatedFiles, type MigrateDeps, type MigrationStep } from "../migrate.ts";
import { readWorkspace } from "../workspace.ts";
import { tempDir } from "./temp-dirs.ts";

/** This repo's root, linked into each consumer as the stock package. */
export const SELF_ROOT: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FIXTURE_TGZ = path.join(SELF_ROOT, "cli", "sync", "__fixtures__", "copied.tgz");
/** A config with every host on and no optional pack. */
export const CONFIG: ResolvedConfig = { packs: ["agents"], agents: { ...AGENT_DEFAULTS, hosts: HOSTS, skills: [] }, ...BASE_CONFIG };
/** The lines the migration of the recorded install prints for its moves, in order. */
export const LINES: readonly string[] = [
  "repo sync: moved .rulesync/rules/team.md to .repo/rules/team.md",
  "repo sync: moved .rulesync/subagents/reviewer.md to .repo/subagents/reviewer.md",
  "repo sync: moved .agents/skills/deploy to .repo/skills/deploy",
  'repo sync: moved your sections "Our hooks" of .rulesync/reference/hooks.md to references/hooks.md',
  "repo sync: moved .rulesync/reference/deploy.md to references/deploy.md",
  "repo sync: moved your .claude/settings.json keys permissions.allow to .repo/settings/claude.json",
  "repo sync: moved .rulesync/lessons/ (1) to .repo/lessons/",
  "repo sync: moved your .rulesync/hooks.jsonc to .repo/hooks.jsonc (it now replaces the stock hooks)",
  "repo sync: moved your .rulesync/mcp-policy.jsonc to .repo/mcp-policy.jsonc",
  'repo sync: moved packs ["listen"] from .rulesync/repo.features.jsonc to agents.skills in repo.config.ts',
];
/** The generated paths the migration of the recorded install untracks; AGENTS.md is shared now, so it stays tracked. */
export const UNTRACKED = ".agents/, .claude/, .codex/, .cursor/, .grok/";
/** The last line of that migration in git. */
export const FINAL = `repo sync: untracked ${UNTRACKED} (now generated) and removed the copied .rulesync/; commit the result`;
/**
 * What sync prints after that migration: the moved rule's old frontmatter rewritten, then the handover, which moves
 * that now pathless rule into AGENTS.md and the policy's server into .mcp.json.
 */
export const HANDOVER: readonly string[] = [
  "repo sync: rewrote .repo/rules/team.md frontmatter (description added, root, targets and globs dropped)",
  "repo sync: moved .repo/rules/team.md into AGENTS.md below repo:rules",
  "repo sync: moved .repo/mcp-policy.jsonc servers into .mcp.json",
];
/** The last line of that migration outside git. */
export const FINAL_NO_GIT = "repo sync: removed the copied .rulesync/";

const extracted: { dir?: string; planned?: Promise<Planned> } = {};

/** The packed copied install, extracted on first use; a packed fixture keeps its .claude/skills out of the repo's tree. */
export function fixtureDir(): string {
  if (extracted.dir !== undefined) return extracted.dir;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-copied-fixture-"));
  tar.x({ file: FIXTURE_TGZ, cwd: dir, sync: true });
  // the pack predates the config's rename: move it as a consumer's sync would, in a throwaway git that lists every
  // file, since that move is not what these suites test
  git(dir, "init", "-q");
  moveOldConfig(dir, { check: false });
  fs.rmSync(path.join(dir, ".git"), { recursive: true, force: true });
  // the packed config lists packs that no longer exist; the migration under test starts from a config that loads
  fs.writeFileSync(
    path.join(dir, "repo.config.ts"),
    'import { defineConfig } from "@workerstack/repo"\n\nexport default defineConfig({\n  packs: ["agents", "docs"],\n})\n',
  );
  extracted.dir = dir;
  return dir;
}

/** Removes the extracted fixture; a test file that used it calls this after all its tests. */
export function dropFixture(): void {
  if (extracted.dir !== undefined) fs.rmSync(extracted.dir, { recursive: true, force: true });
}

/** Writes `text` at `rel`, first making a file sync left read-only writable, as a hand edit has to. */
export function write(root: string, rel: string, text: string): void {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.lstatSync(file, { throwIfNoEntry: false })?.isFile() === true) fs.chmodSync(file, 0o644);
  fs.writeFileSync(file, text);
}

/** The text at `rel`. */
export function read(root: string, rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

/** The JSON at `rel`, read as the shape the caller names. */
export function readJson<T>(root: string, rel: string): T {
  return JSON.parse(read(root, rel)) /* the caller names the shape sync or the test wrote there */ as T;
}

/** Whether a file, dir or link (dangling or not) is at `rel`. */
export function exists(root: string, rel: string): boolean {
  return (
    fs.existsSync(path.join(root, rel)) || fs.lstatSync(path.join(root, rel), { throwIfNoEntry: false }) !== undefined
  );
}

/** Runs git in `root` with a fixed identity; throws on a failure. */
export function git(root: string, ...args: string[]): string {
  const result = spawnSync(
    "git",
    ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args],
    { cwd: root, encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout;
}

/** Links this repo into `root` as the stock package. */
export function linkStock(root: string): void {
  fs.mkdirSync(path.join(root, "node_modules", "@workerstack"), { recursive: true });
  fs.symlinkSync(SELF_ROOT, path.join(root, "node_modules", "@workerstack", "repo"), "dir");
}

/** Commits everything in `root` but node_modules as one commit. */
export function commitAll(root: string, message: string): void {
  git(root, "init", "-q");
  fs.appendFileSync(path.join(root, ".git", "info", "exclude"), "node_modules/\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", message);
}

/** The recorded copied install in a temp dir: the fixture, this repo linked as the stock package, one commit. */
export function copied(options: { git?: boolean } = {}): string {
  const root = tempDir("workerstack-migrate-");
  fs.cpSync(fixtureDir(), root, { recursive: true, verbatimSymlinks: true });
  linkStock(root);
  if (options.git !== false) commitAll(root, "copied install");
  return root;
}

/** A consumer that never ran the copying init: a config, the stock linked in, and `files`, committed unless not. */
export function plain(files: Record<string, string>, options: { git?: boolean } = {}): string {
  const root = tempDir("workerstack-migrate-");
  write(root, "repo.config.ts", "export default {}\n");
  write(root, "package.json", JSON.stringify({ name: "fixture" }));
  for (const [rel, text] of Object.entries(files)) write(root, rel, text);
  linkStock(root);
  if (options.git !== false) commitAll(root, "own files");
  return root;
}

/** The stock package a consumer under test has linked in. */
export function stockOf(root: string): string {
  return path.join(root, "node_modules", "@workerstack", "repo");
}

/** Every file and link under `root` outside node_modules and .git, with its text or link target. */
export function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (rel: string): void => {
    for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const next = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (rel === "" && (entry.name === "node_modules" || entry.name === ".git")) continue;
      if (entry.isSymbolicLink()) out[next] = `-> ${fs.readlinkSync(path.join(root, next))}`;
      else if (entry.isDirectory()) walk(next);
      else out[next] = fs.readFileSync(path.join(root, next), "utf8");
    }
  };
  walk("");
  return out;
}

/** The generated files and ignore entries planMigration compares a copied install with. */
export interface Planned {
  generated: Map<string, string>;
  ignored: string[];
}

/** What sync generates for `root` before it migrates: the stock's own generated text, as runSync hands it over. */
async function generatedOf(root: string): Promise<Planned> {
  const config = await loadConfig(root);
  const workspace = readWorkspace(root);
  if (!config.ok || !workspace.ok) throw new Error("the copied install does not load");
  const planned = computeOutputs({ root, config: config.config, workspace: workspace.workspace });
  if (!planned.ok) throw new Error(planned.errors.join("\n"));
  return {
    generated: generatedFiles(planned.outputs),
    ignored: untrackedEntries(config.config.agents.hosts, planned.outputs),
  };
}

/** The generated files and ignore entries of the copied fixture, the same for every copy of it; rendered once. */
export function fixturePlanned(): Promise<Planned> {
  extracted.planned ??= generatedOf(copied({ git: false }));
  return extracted.planned;
}

/** The migration planned for a copy of the recorded install at `root`. */
export async function copiedPlan(root: string, deps: MigrateDeps = {}): Promise<MigrationStep[]> {
  return planMigration(root, { stock: stockOf(root), ...(await fixturePlanned()) }, deps);
}

/** Plans and applies the migration of a copy of the recorded install; its printed lines. */
export async function migrate(root: string, deps: MigrateDeps = {}): Promise<string[]> {
  return applyMigration(root, await copiedPlan(root, deps), deps);
}

/** repo sync in `root`; `full` runs every generator, otherwise none, so only the migration and the checks run. */
export function sync(root: string, args: string[], full = false): Promise<{ code: number; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const io = { cwd: root, stdout: (s: string) => out.push(s), stderr: (s: string) => err.push(s) };
  return runSync(args, io, full ? {} : { generators: [], post: [] }).then((code) => ({ code, out, err }));
}
