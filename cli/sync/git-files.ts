import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { applyEdits, modify, parse, printParseErrorCode, type ParseError } from "jsonc-parser";
import type { Host } from "../config.ts";
import { mergeBlock } from "../scripts/managed-text.ts";
import { HOST_TREES } from "./hosts.ts";
import type { Output, SyncContext } from "./outputs.ts";
import { isSelfName } from "./stock.ts";
import type { Workspace } from "./workspace.ts";

/** What a pass over the generators' outputs returns: more outputs, or the errors that stopped it. */
export type PostPass = (ctx: SyncContext, outputs: readonly Output[]) => { outputs: Output[]; errors: string[] };

type FileOutput = Extract<Output, { kind: "file" }>;
type Result = { outputs: Output[]; errors: string[] };

const GITIGNORE_PATH = ".gitignore";
const GITATTRIBUTES_PATH = ".gitattributes";
const SETTINGS_PATH = ".vscode/settings.json";
const BLOCK_BEGIN = "# >>> @workerstack/repo";
const BLOCK_END = "# <<< @workerstack/repo";
const IGNORE_BASE = [".tmp/", ".worktrees/", ".repo/tmp/"];
const DEPENDENCY_DIR = `${"node"}_modules/`;
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
 * the outermost such dir, any other is listed as its exact path. Files first, then dirs, each sorted.
 */
export function untrackedEntries(hosts: readonly Host[], outputs: readonly Output[]): string[] {
  const owned = hosts.flatMap((host) => HOST_TREES[host].owns).sort((a, b) => a.length - b.length);
  const entries = new Set<string>();
  for (const output of outputs) {
    if (output.tracked || output.managed !== "whole") continue;
    entries.add(owned.find((dir) => output.path.startsWith(dir)) ?? output.path);
  }
  const all = [...entries];
  return [...all.filter((entry) => !entry.endsWith("/")).sort(byName), ...all.filter((entry) => entry.endsWith("/")).sort(byPath)];
}

/**
 * The post-pass over the generators' outputs: the managed blocks of `.gitignore` and `.gitattributes`, and
 * `files.readonlyInclude` in `.vscode/settings.json`. Block outputs are left out of all three.
 */
export const gitFiles: PostPass = (ctx, outputs) => {
  const results = [gitignore(ctx, outputs), gitattributes(ctx, outputs), settings(ctx, outputs)];
  return { outputs: results.flatMap((result) => result.outputs), errors: results.flatMap((result) => result.errors) };
};

/** A block output in `rel`: sync's `body` between the markers, the rest of the file as the user wrote it. */
function blockFile(ctx: SyncContext, rel: string, body: string[]): Result {
  const merged = mergeBlock(ctx.read(rel) ?? "", BLOCK_BEGIN, BLOCK_END, body.join("\n"));
  if (!merged.ok) return { outputs: [], errors: [`${rel}: ${merged.error}`] };
  return { outputs: [{ kind: "file", path: rel, content: merged.text, tracked: true, managed: "block" }], errors: [] };
}

/**
 * The lines of the managed `.gitignore` block: the base entries, the dependency dir and what the untracked outputs
 * need. This repo keeps its own dependency line outside the block and commits its trees, so its untracked list is empty.
 */
export function ignoreBlockLines(name: string | undefined, hosts: readonly Host[], outputs: readonly Output[]): string[] {
  const dependencies = isSelfName(name) ? [] : [DEPENDENCY_DIR];
  return [...IGNORE_BASE, ...dependencies, ...untrackedEntries(hosts, outputs)];
}

function gitignore(ctx: SyncContext, outputs: readonly Output[]): Result {
  return blockFile(ctx, GITIGNORE_PATH, ignoreBlockLines(ctx.workspace.manifest.name, ctx.config.agents.hosts, outputs));
}

function gitattributes(ctx: SyncContext, outputs: readonly Output[]): Result {
  const generated = wholeFiles(outputs)
    .filter((output) => output.tracked)
    .map((output) => output.path)
    .sort(byPath);
  return blockFile(ctx, GITATTRIBUTES_PATH, [ATTRIBUTES_BASE, ...generated.map((rel) => `${rel} linguist-generated`)]);
}

/** `files.readonlyInclude` set to every whole file output; the settings file's other keys and comments stay as written. */
function settings(ctx: SyncContext, outputs: readonly Output[]): Result {
  const existing = ctx.read(SETTINGS_PATH);
  const fresh = (existing ?? "").trim() === "";
  const text = fresh ? "{}" : (existing as string);
  const problems: ParseError[] = [];
  const value: unknown = parse(text, problems, { allowTrailingComma: true });
  if (problems.length > 0) {
    const { error, offset } = problems[0] as ParseError;
    return { outputs: [], errors: [`${SETTINGS_PATH}: invalid JSONC: ${printParseErrorCode(error)} at offset ${offset}`] };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { outputs: [], errors: [`${SETTINGS_PATH}: must hold a JSON object`] };
  }
  const readonly = Object.fromEntries(
    wholeFiles(outputs)
      .map((output) => output.path)
      .sort(byPath)
      .map((rel) => [rel, true]),
  );
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  // Inserted first, the new key leaves every neighbour's whitespace as written; appended, its formatting would rewrite the last one's.
  const options = { formattingOptions: { insertSpaces: true, tabSize: 2, eol }, getInsertionIndex: () => 0 };
  const edited = applyEdits(text, modify(text, [READONLY_KEY], readonly, options));
  return { outputs: [{ kind: "file", path: SETTINGS_PATH, content: fresh ? `${edited}${eol}` : edited, tracked: true, managed: "block" }], errors: [] };
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
  let listed: string;
  try {
    listed = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", ...ignored.flatMap((line) => ["-x", line]), "-z"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return [];
  }
  const publicRoots = new Set(workspace.packages.filter((pkg) => pkg.manifest.private !== true).map((pkg) => pkg.dir));
  const lines: string[] = [];
  // A deleted tracked file stays in the index, and an unmerged path is listed once per stage.
  for (const rel of [...new Set(listed.split("\0"))].sort(byPath)) {
    const name = path.posix.basename(rel);
    const nested = name === ".gitignore" && path.posix.dirname(rel) !== "." && !publicRoots.has(path.posix.dirname(rel));
    if ((name === ".npmignore" || nested) && fs.existsSync(path.join(root, rel))) {
      lines.push(`${rel}: ${name === ".npmignore" ? NPM_IGNORE : NESTED_IGNORE}`);
    }
  }
  return lines;
}
