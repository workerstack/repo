import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import type { Host } from "../config.ts";
import { IGNORED_DIRS, REPO } from "../repo-dirs.ts";
import { blockOutput } from "./block-output.ts";
import { byCodeUnit } from "./by-code-unit.ts";
import { BACKLOG_FILE, GITIGNORE_PATH, NPM_IGNORE_FILE } from "./git-files.constants.ts";
import { HOST_TREES } from "./hosts.ts";
import { KNIP_CONFIG_PATH, KNIP_UNIGNORED_GLOB } from "./knip-config.ts";
import type { Output, SyncContext } from "./outputs.ts";
import { OXLINT_CONFIG_PATH, UNSKIPPED_CONFIG_GLOB } from "./oxlint-config.ts";
import { syntaxOf, writeRegions } from "./region.ts";
import { CARGO_TARGET_DIR, TOOLCHAIN_PATH } from "./rust.constants.ts";
import { settingsEdit } from "./settings-edit.ts";
import { isSelfName } from "./stock.ts";
import { TURBO_CONFIG_PATH, TURBO_DIR } from "./turbo.constants.ts";
import type { Workspace } from "./workspace.ts";

/** What a pass over the generators' outputs returns: more outputs, or the errors that stopped it. */
export type PostPass = (ctx: SyncContext, outputs: readonly Output[]) => { outputs: Output[]; errors: string[] };

type FileOutput = Extract<Output, { kind: "file" }>;

type Result = { outputs: Output[]; errors: string[] };

const GITATTRIBUTES_PATH = ".gitattributes";
const SETTINGS_PATH = ".vscode/settings.json";

/** Every path the git files pass plans, for a pass that runs before it and must name them. */
export const GIT_FILE_PATHS: readonly string[] = [GITIGNORE_PATH, GITATTRIBUTES_PATH, SETTINGS_PATH];
const IGNORE_REGION = "ignore";
const ATTRIBUTES_REGION = "generated";

/** The lines every `.gitignore` block starts with; the bare `.tmp/` stays so a root `.tmp` is still ignored. */
export const IGNORE_BASE: readonly string[] = [
  ".tmp/",
  ".worktrees/",
  "coverage/",
  .../* @__PURE__ */ IGNORED_DIRS.map((dir) => `**/${REPO}/${dir}/`),
  `**/${REPO}/${BACKLOG_FILE}`,
];

const DEPENDENCY_DIR = `node_modules/`;
const ATTRIBUTES_BASE = "* text=auto eol=lf";

const LEADING_DOT = /^\./;

/** Sorts a leading dot away, so `AGENTS.md` stays before `.mcp.json` as the gitignore block always listed them. */
function byName(a: string, b: string) {
  return byCodeUnit(a.replace(LEADING_DOT, ""), b.replace(LEADING_DOT, ""));
}

/** The file outputs sync owns whole, which the user never writes into. */
function wholeFiles(outputs: readonly Output[]): FileOutput[] {
  return outputs.flatMap((output) => (output.kind === "file" && output.managed === "whole" ? [output] : []));
}

/**
 * What git must ignore for the untracked whole outputs: an output under a dir an enabled host owns collapses to
 * the outermost such dir, any other is listed as its exact path, and the oxlint and knip configs bring the
 * pattern of their one-run copies. Files first, then dirs, each sorted.
 */
export function untrackedEntries(hosts: readonly Host[], outputs: readonly Output[]): string[] {
  const owned = hosts.flatMap((host) => HOST_TREES[host].owns).toSorted((a, b) => a.length - b.length);
  const entries = new Set<string>();

  for (const output of outputs) {
    if (output.tracked || output.managed !== "whole") continue;
    entries.add(owned.find((dir) => output.path.startsWith(dir)) ?? output.path);
  }

  // `repo check` writes a skip-free copy beside the oxlint config for one run.
  if (entries.has(OXLINT_CONFIG_PATH)) entries.add(UNSKIPPED_CONFIG_GLOB);

  // `repo check` writes an ignore-free copy beside the knip config for one run.
  if (entries.has(KNIP_CONFIG_PATH)) entries.add(KNIP_UNIGNORED_GLOB);

  // The pack that writes `turbo.json` runs turbo, whose cache and skip report live in `.turbo/`.
  if (entries.has(TURBO_CONFIG_PATH)) entries.add(TURBO_DIR);

  // The pack that writes the toolchain pin runs cargo, whose build dir is `target/`.
  if (entries.has(TOOLCHAIN_PATH)) entries.add(CARGO_TARGET_DIR);
  const all = [...entries];

  return [
    ...all.filter((entry) => !entry.endsWith("/")).toSorted(byName),
    ...all.filter((entry) => entry.endsWith("/")).toSorted(byCodeUnit),
  ];
}

/**
 * The post-pass over the generators' outputs: the `repo:ignore` region of `.gitignore`, the `repo:generated` region
 * of `.gitattributes`, and `files.readonlyInclude` in `.vscode/settings.json`. Block outputs are left out of all three.
 */
export function gitFiles(ctx: SyncContext, outputs: readonly Output[]): Result {
  const results = [gitignore(ctx, outputs), gitattributes(ctx, outputs), settings(ctx, outputs)];

  return { errors: results.flatMap((result) => result.errors), outputs: results.flatMap((result) => result.outputs) };
}

/** A block output in `rel`: sync's region `name` holding `body`, the rest of the file as the user wrote it. */
function blockFile(ctx: SyncContext, rel: string, [name, body]: readonly [string, string[]]): Result {
  const region = { body: body.join("\n"), name, place: "bottom" } as const;

  return { errors: [], outputs: [blockOutput(rel, writeRegions(ctx.read(rel) ?? "", syntaxOf(rel), [region]))] };
}

/**
 * The lines of the managed `.gitignore` block: the base entries, the dependency dir and what the untracked outputs
 * need. This repo keeps its own dependency line outside the block and commits its trees, so its untracked list is
 * empty.
 */
export function ignoreBlockLines(
  name: string | undefined,
  hosts: readonly Host[],
  outputs: readonly Output[],
): string[] {
  const dependencies = isSelfName(name) ? [] : [DEPENDENCY_DIR];

  return [...IGNORE_BASE, ...dependencies, ...untrackedEntries(hosts, outputs)];
}

function gitignore(ctx: SyncContext, outputs: readonly Output[]): Result {
  const lines = ignoreBlockLines(ctx.workspace.manifest.name, ctx.config.agents.hosts, outputs);

  return blockFile(ctx, GITIGNORE_PATH, [IGNORE_REGION, lines]);
}

function gitattributes(ctx: SyncContext, outputs: readonly Output[]): Result {
  const generated = wholeFiles(outputs)
    .filter((output) => output.tracked)
    .map((output) => output.path)
    .toSorted(byCodeUnit)
    .map((rel) => `${rel} linguist-generated`);

  return blockFile(ctx, GITATTRIBUTES_PATH, [ATTRIBUTES_REGION, [ATTRIBUTES_BASE, ...generated]]);
}

/**
 * `files.readonlyInclude` set to every whole file output; the settings file's other keys and comments stay as written.
 * A file that is not valid JSONC or holds no object is left as is, its output unchanged with the reason as its repair.
 */
function settings(ctx: SyncContext, outputs: readonly Output[]): Result {
  const paths = wholeFiles(outputs).map((output) => output.path);

  return { errors: [], outputs: [blockOutput(SETTINGS_PATH, settingsEdit(ctx.read(SETTINGS_PATH), paths))] };
}

/**
 * Every file git sees under `root` (tracked, or untracked and not ignored) as sorted POSIX paths, with the
 * `extraIgnores` lines applied on top of the ignore files already there. A deleted tracked file stays in the index,
 * so it is listed too. Null outside a git repo or when git fails.
 */
export function listedFiles(root: string, extraIgnores: readonly string[]): string[] | null {
  try {
    const listed = execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", ...extraIgnores.flatMap((line) => ["-x", line]), "-z"],
      {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );

    // An unmerged path is listed once per stage.
    return [...new Set(listed.split("\0").filter((rel) => rel !== ""))].toSorted(byCodeUnit);
  } catch {
    return null;
  }
}

const NESTED_IGNORE = "ignore rules live in the root .gitignore (or a public package's own); move them there";
const NPM_IGNORE = 'npm reads package.json "files"; delete it';

/**
 * One `path: reason` line per ignore file git sees (tracked, or untracked and not ignored) that sync refuses: a
 * `.gitignore` below the root outside a public package's root (its package.json lacks `"private": true`), and any
 * `.npmignore`. `ignored` are the lines of the `.gitignore` block sync is about to write, which git applies on top of
 * the ignore files already there, so a new repo is not judged by what its first sync would ignore. None outside a
 * git repo or when git fails.
 */
export function strayIgnoreFiles(root: string, workspace: Workspace, ignored: readonly string[]): string[] {
  const listed = listedFiles(root, ignored);

  if (listed === null) return [];
  const publicRoots = new Set(workspace.packages.filter((pkg) => pkg.manifest.private !== true).map((pkg) => pkg.dir));
  const lines: string[] = [];

  for (const rel of listed) {
    const name = path.posix.basename(rel);

    const nested =
      name === GITIGNORE_PATH && path.posix.dirname(rel) !== "." && !publicRoots.has(path.posix.dirname(rel));

    if ((name === NPM_IGNORE_FILE || nested) && fs.existsSync(path.join(root, rel)))
      lines.push(`${rel}: ${name === NPM_IGNORE_FILE ? NPM_IGNORE : NESTED_IGNORE}`);
  }

  return lines;
}
