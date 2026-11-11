import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { applyEdits, modify, parse, printParseErrorCode, type ParseError } from "jsonc-parser";

import type { Host } from "../config.ts";
import { HOST_TREES } from "./hosts.ts";
import { KNIP_CONFIG_PATH, KNIP_UNIGNORED_GLOB } from "./knip-config.ts";
import type { Output, SyncContext } from "./outputs.ts";
import { OXLINT_CONFIG_PATH, UNSKIPPED_CONFIG_GLOB } from "./oxlint-config.ts";
import { syntaxOf, writeRegions } from "./region.ts";
import { CARGO_TARGET_DIR, TOOLCHAIN_PATH } from "./rust.constants.ts";
import { isSelfName } from "./stock.ts";
import { TURBO_CONFIG_PATH, TURBO_DIR } from "./turbo.constants.ts";
import type { Workspace } from "./workspace.ts";

/** What a pass over the generators' outputs returns: more outputs, or the errors that stopped it. */
export type PostPass = (ctx: SyncContext, outputs: readonly Output[]) => { outputs: Output[]; errors: string[] };

type FileOutput = Extract<Output, { kind: "file" }>;
type Result = { outputs: Output[]; errors: string[] };

const GITIGNORE_PATH = ".gitignore";
const GITATTRIBUTES_PATH = ".gitattributes";
const SETTINGS_PATH = ".vscode/settings.json";
/** Every path the git files pass plans, for a pass that runs before it and must name them. */
export const GIT_FILE_PATHS: readonly string[] = [GITIGNORE_PATH, GITATTRIBUTES_PATH, SETTINGS_PATH];
const IGNORE_REGION = "ignore";
const ATTRIBUTES_REGION = "generated";
const IGNORE_BASE = [".tmp/", ".worktrees/", ".repo/tmp/", "coverage/"];
const DEPENDENCY_DIR = `node_modules/`;
const ATTRIBUTES_BASE = "* text=auto eol=lf";
const READONLY_KEY = "files.readonlyInclude";

const byPath = (a: string, b: string) => Number(a > b) - Number(a < b);
/** Sorts a leading dot away, so `AGENTS.md` stays before `.mcp.json` as the gitignore block always listed them. */
const byName = (a: string, b: string) => byPath(a.replace(/^\./, ""), b.replace(/^\./, ""));

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
  const owned = hosts.flatMap((host) => HOST_TREES[host].owns).sort((a, b) => a.length - b.length);
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
    ...all.filter((entry) => !entry.endsWith("/")).sort(byName),
    ...all.filter((entry) => entry.endsWith("/")).sort(byPath),
  ];
}

/**
 * The post-pass over the generators' outputs: the `repo:ignore` region of `.gitignore`, the `repo:generated` region
 * of `.gitattributes`, and `files.readonlyInclude` in `.vscode/settings.json`. Block outputs are left out of all three.
 */
export const gitFiles: PostPass = (ctx, outputs) => {
  const results = [gitignore(ctx, outputs), gitattributes(ctx, outputs), settings(ctx, outputs)];
  return { errors: results.flatMap((result) => result.errors), outputs: results.flatMap((result) => result.outputs) };
};

/** A block output in `rel`: sync's region `name` holding `body`, the rest of the file as the user wrote it. */
function blockFile(ctx: SyncContext, rel: string, [name, body]: readonly [string, string[]]): Result {
  const region = { body: body.join("\n"), name, place: "bottom" } as const;
  const { text, repairs } = writeRegions(ctx.read(rel) ?? "", syntaxOf(rel), [region]);
  return { errors: [], outputs: [blockOutput(rel, text, repairs)] };
}

/** The tracked block output at `rel` holding `text`, with the repairs that led to it when there are any. */
function blockOutput(rel: string, text: string, repairs: readonly string[]): Output {
  const output: Output = { content: text, kind: "file", managed: "block", path: rel, tracked: true };
  return repairs.length === 0 ? output : { ...output, repairs };
}

/**
 * The lines of the managed `.gitignore` block: the base entries, the dependency dir and what the untracked outputs
 * need. This repo keeps its own dependency line outside the block and commits its trees, so its untracked list is empty.
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
    .sort(byPath)
    .map((rel) => `${rel} linguist-generated`);
  return blockFile(ctx, GITATTRIBUTES_PATH, [ATTRIBUTES_REGION, [ATTRIBUTES_BASE, ...generated]]);
}

/**
 * `files.readonlyInclude` set to every whole file output; the settings file's other keys and comments stay as written.
 * A file that is not valid JSONC or holds no object is left as is, its output unchanged with the reason as its repair.
 */
function settings(ctx: SyncContext, outputs: readonly Output[]): Result {
  const existing = ctx.read(SETTINGS_PATH);
  const fresh = (existing ?? "").trim() === "";
  const text = fresh ? "{}" : (existing as string);
  const kept = unusable(text);
  if (kept !== null) return { errors: [], outputs: [blockOutput(SETTINGS_PATH, text, [kept])] };
  const readonly = Object.fromEntries(
    wholeFiles(outputs)
      .map((output) => output.path)
      .sort(byPath)
      .map((rel) => [rel, true]),
  );
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  // Inserted first, the new key leaves every neighbour's whitespace as written; appended, its formatting would rewrite the last one's.
  const options = { formattingOptions: { eol, insertSpaces: true, tabSize: 2 }, getInsertionIndex: () => 0 };
  const edited = applyEdits(text, modify(text, [READONLY_KEY], readonly, options));
  return { errors: [], outputs: [blockOutput(SETTINGS_PATH, fresh ? `${edited}${eol}` : edited, [])] };
}

/** Why settings `text` is left as is, naming the line of its first JSONC error; null when it holds an object. */
function unusable(text: string): string | null {
  const problems: ParseError[] = [];
  const value: unknown = parse(text, problems, { allowTrailingComma: true });
  const [problem] = problems;
  if (problem !== undefined) {
    const line = text.slice(0, problem.offset).split("\n").length;
    return `not valid JSONC at line ${line} (${printParseErrorCode(problem.error)}); left as is`;
  }
  const object = typeof value === "object" && value !== null && !Array.isArray(value);
  return object ? null : "must hold a JSON object; left as is";
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
    return [...new Set(listed.split("\0").filter((rel) => rel !== ""))].sort(byPath);
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
      name === ".gitignore" && path.posix.dirname(rel) !== "." && !publicRoots.has(path.posix.dirname(rel));
    if ((name === ".npmignore" || nested) && fs.existsSync(path.join(root, rel)))
      lines.push(`${rel}: ${name === ".npmignore" ? NPM_IGNORE : NESTED_IGNORE}`);
  }
  return lines;
}
