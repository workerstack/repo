import fs from "node:fs";
import path from "node:path";
import { DEFAULT_MAX_CHANGED_LINES, findRoot, loadConfig } from "./config.ts";
import { type GitRun, runGit } from "./sync/standards.ts";
import { readWorkspace, type Workspace } from "./sync/workspace.ts";

/** The Conventional Commits types a commit may use. */
export const TYPES: string[] = ["feat", "fix", "perf", "refactor", "test", "docs", "build", "ci", "chore", "revert"];

/** Scopes every monorepo accepts besides its workspace package names. */
export const REPO_SCOPES: string[] = ["repo", "deps", "ci"];

const MAX_HEADER = 100;
const HEADER = /^(?<type>[^\s():!]+)(?:\((?<scope>[^()]*)\))?(?<bang>!)?: (?<subject>.+)$/;
const NEEDS_TEST = new Set(["feat", "fix"]);
/** The line above the diff `git commit --verbose` appends; everything from it down is not the message. */
const SCISSORS = "# ------------------------ >8 ------------------------";
/** Files whose size says nothing about the change: lockfiles, by name anywhere, and the lint baseline. */
const UNCOUNTED_NAMES = new Set(["bun.lock", "bun.lockb", "package-lock.json", "yarn.lock", "pnpm-lock.yaml"]);
const UNCOUNTED_PATHS = new Set([".repo/lint-baseline.json"]);

/** What a message is checked against: the staged paths and changed lines, the limit, and the workspace's scopes. */
export type CommitFacts = {
  stagedFiles: string[];
  changedLines: number;
  maxChangedLines: number;
  scopes?: string[] | undefined;
};
/** The staged change: every path, and the changed lines that count toward the size limit. */
export type StagedChange = { files: string[]; changedLines: number };
/** What the repo's config and workspace set: the size limit, and the scopes of a monorepo. */
export type CommitRules = { maxChangedLines: number; scopes?: string[] | undefined };
/** Where `repo commit-msg` runs and prints. */
export type CommitMsgIo = { cwd: string; stderr: (text: string) => void };

/** True when the path is a test: a `*.test.*` or `*.spec.*` file, or a file under an `e2e/` folder. */
export function isTestFile(file: string): boolean {
  return /\.(test|spec)\.[^/]+$/.test(file) || /(^|\/)e2e\//.test(file);
}

/** The scope problem, if any: kebab-case always, and one of `scopes` or the repo scopes when `scopes` is given. */
function scopeProblems(scope: string | undefined, scopes: string[] | undefined): string[] {
  if (scope === undefined) return [];
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(scope)) return [`the scope "${scope}" must be lowercase kebab-case`];
  if (scopes === undefined || scopes.includes(scope) || REPO_SCOPES.includes(scope)) return [];
  const known = `one of ${REPO_SCOPES.join(", ")} (${scopes.join(", ")})`;
  return [`unknown scope "${scope}"; use a workspace package name or ${known}`];
}

/** The size problem, if any: over the limit, the message needs a body line saying why. */
function sizeProblems(body: readonly string[], { changedLines, maxChangedLines }: CommitFacts): string[] {
  if (changedLines <= maxChangedLines || body.some((line) => line.trim() !== "")) return [];
  return [
    `the commit changes ${changedLines} lines, over the limit of ${maxChangedLines}; add a body line saying why, or split it`,
  ];
}

/** The lines of the message itself: no comment, and nothing from the verbose diff's scissors line down. */
function messageLines(message: string): string[] {
  const all = message.split("\n");
  const scissors = all.indexOf(SCISSORS);
  return (scissors === -1 ? all : all.slice(0, scissors)).filter((line) => !line.startsWith("#"));
}

/**
 * Checks one commit message against the Conventional Commits rules and the size limit, and returns every problem it
 * finds, or an empty list when the message passes. Without `scopes` any kebab-case scope is accepted.
 */
export function checkCommitMessage(message: string, facts: CommitFacts): string[] {
  const lines = messageLines(message);
  const at = lines.findIndex((line) => line.trim() !== "");
  const header = lines[at];
  if (header === undefined) return ["the commit message is empty"];
  if (header.startsWith("Merge ")) return [];

  const match = HEADER.exec(header);
  if (!match) return ['the header must be "type(scope)!: subject", e.g. "fix(paths): compare hook paths canonically"'];

  // the HEADER regex always captures type and subject; scope is optional
  const { type, scope, subject } = match.groups as { type: string; scope: string | undefined; subject: string };
  const problems: string[] = [];
  if (!TYPES.includes(type)) problems.push(`unknown type "${type}"; use one of ${TYPES.join(", ")}`);
  problems.push(...scopeProblems(scope, facts.scopes));
  if (/^[A-Z]/.test(subject)) problems.push("the subject must start lowercase");
  if (subject.endsWith(".")) problems.push("the subject must not end with a period");
  if (header.length > MAX_HEADER) problems.push(`the header is ${header.length} characters; keep it to ${MAX_HEADER}`);
  if (NEEDS_TEST.has(type) && !facts.stagedFiles.some(isTestFile)) {
    problems.push(`a ${type} commit must include a test change (a *.test.* or *.spec.* file, or a file under e2e/)`);
  }
  return [...problems, ...sizeProblems(lines.slice(at + 1), facts)];
}

/** One `git diff --numstat -z` entry: its path, and its changed lines, or null for a binary file. */
type Numstat = { file: string; lines: number | null };

/** The entries of `git diff --numstat -z`; a rename is `a\td\t` followed by its old and new path. */
function parseNumstat(out: string): Numstat[] {
  const tokens = out.split("\0");
  const entries: Numstat[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const match = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(tokens[i] as string);
    if (match === null) continue;
    const [, added, deleted, named] = match as unknown as [string, string, string, string];
    const file = named === "" ? (tokens[(i += 2)] as string) : named;
    entries.push({ file, lines: added === "-" ? null : Number(added) + Number(deleted) });
  }
  return entries;
}

/** The paths among `files` the staged `.gitattributes` mark `linguist-generated`. */
function generatedPaths(root: string, files: readonly string[], git: GitRun): Set<string> {
  const result = git(root, ["check-attr", "--cached", "-z", "--stdin", "linguist-generated"], files.join("\0"));
  const tokens = result.stdout.split("\0");
  const generated = new Set<string>();
  for (let i = 0; i + 2 < tokens.length; i += 3) {
    if (tokens[i + 2] === "set" || tokens[i + 2] === "true") generated.add(tokens[i] as string);
  }
  return generated;
}

/**
 * The staged change at `root`: every staged path, and the insertions plus deletions that count toward the size
 * limit, leaving out binaries, lockfiles, the lint baseline and `linguist-generated` paths. Nothing outside a repo.
 */
export function stagedChange(root: string, git: GitRun = runGit): StagedChange {
  const diff = git(root, ["diff", "--cached", "--numstat", "-z"]);
  if (diff.status !== 0) return { files: [], changedLines: 0 };
  const entries = parseNumstat(diff.stdout);
  const files = entries.map((entry) => entry.file);
  const generated = generatedPaths(root, files, git);
  const counted = entries.filter(
    ({ file }) => !UNCOUNTED_NAMES.has(path.posix.basename(file)) && !UNCOUNTED_PATHS.has(file) && !generated.has(file),
  );
  return { files, changedLines: counted.reduce((sum, entry) => sum + (entry.lines ?? 0), 0) };
}

/** The scopes of a monorepo: the last segment of each workspace package name, or its folder; none for one package. */
function scopesOf(workspace: Workspace): string[] | undefined {
  if (workspace.packages.length === 0) return undefined;
  const names = workspace.packages.map(({ dir, manifest }) => (manifest.name ?? dir).split("/").at(-1) as string);
  return [...new Set(names)].sort();
}

/** The limit and scopes for the repo at or above `cwd`: the defaults without a config, or the problems loading it. */
async function commitRules(cwd: string): Promise<CommitRules | string[]> {
  const root = findRoot(cwd);
  if (root === null) return { maxChangedLines: DEFAULT_MAX_CHANGED_LINES };
  const loaded = await loadConfig(root);
  if (!loaded.ok) return loaded.errors;
  const workspace = readWorkspace(root);
  if (!workspace.ok) return workspace.errors;
  return { maxChangedLines: loaded.config.commit.maxChangedLines, scopes: scopesOf(workspace.workspace) };
}

/**
 * The commit-msg check of the message file at `messageFile` (relative to `io.cwd`, the repo top level git runs hooks
 * in) against the staged change and `rules`: prints each problem and returns 0 to let the commit through, 1 to refuse.
 */
export function runCommitMsgHook(messageFile: string, rules: CommitRules, io: CommitMsgIo): number {
  const staged = stagedChange(io.cwd);
  const message = fs.readFileSync(path.resolve(io.cwd, messageFile), "utf8");
  const facts = { ...rules, stagedFiles: staged.files, changedLines: staged.changedLines };
  const problems = checkCommitMessage(message, facts);
  if (problems.length === 0) return 0;
  io.stderr(`commit-msg: the message was refused\n${problems.map((problem) => `  - ${problem}\n`).join("")}`);
  return 1;
}

/**
 * `repo commit-msg <file>`, the commit-msg git hook: `runCommitMsgHook` with the config's size limit and the
 * workspace's scopes, or exit 1 with the reason when the file is not named or the config is broken.
 */
export async function main(
  argv: string[],
  io: CommitMsgIo = { cwd: process.cwd(), stderr: (text) => process.stderr.write(text) },
): Promise<number> {
  const [file] = argv;
  if (file === undefined || argv.length > 1) {
    io.stderr("repo commit-msg: name the commit message file, as git's commit-msg hook does\n");
    return 1;
  }
  const rules = await commitRules(io.cwd);
  if (Array.isArray(rules)) {
    for (const error of rules) io.stderr(`repo commit-msg: ${error}\n`);
    return 1;
  }
  return runCommitMsgHook(file, rules, io);
}
