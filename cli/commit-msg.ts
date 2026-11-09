import fs from "node:fs";
import { spawnSync } from "./spawn.ts";

/** The Conventional Commits types a commit may use. */
export const TYPES = ["feat", "fix", "perf", "refactor", "test", "docs", "build", "ci", "chore", "revert"];

/** Scopes every monorepo accepts besides its workspace package names. */
export const REPO_SCOPES = ["repo", "deps", "ci"];

const MAX_HEADER = 100;
const HEADER = /^(?<type>[^\s():!]+)(?:\((?<scope>[^()]*)\))?(?<bang>!)?: (?<subject>.+)$/;
const NEEDS_TEST = new Set(["feat", "fix"]);

/** True when the path is a test: a `*.test.*` or `*.spec.*` file, or a file under an `e2e/` folder. */
export function isTestFile(file: string) {
  return /\.(test|spec)\.[^/]+$/.test(file) || /(^|\/)e2e\//.test(file);
}

/**
 * Checks one commit message against the Conventional Commits rules and returns every problem it finds,
 * or an empty list when the message passes. `scopes`, when given, is the list of workspace package names.
 */
export function checkCommitMessage(
  message: string,
  { stagedFiles, scopes }: { stagedFiles: string[]; scopes?: string[] },
): string[] {
  const lines = message.split("\n").filter((line) => !line.startsWith("#"));
  const header = lines.find((line) => line.trim() !== "");
  if (header === undefined) return ["the commit message is empty"];
  if (header.startsWith("Merge ")) return [];

  const match = HEADER.exec(header);
  if (!match) return ['the header must be "type(scope)!: subject", e.g. "fix(paths): compare hook paths canonically"'];

  // the HEADER regex always captures type and subject; scope is optional
  const { type, scope, subject } = match.groups as { type: string; scope: string | undefined; subject: string };
  const problems: string[] = [];
  if (!TYPES.includes(type)) problems.push(`unknown type "${type}"; use one of ${TYPES.join(", ")}`);
  if (scope !== undefined) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(scope)) problems.push(`the scope "${scope}" must be lowercase kebab-case`);
    else if (scopes && !scopes.includes(scope) && !REPO_SCOPES.includes(scope)) {
      problems.push(
        `unknown scope "${scope}"; use a workspace package name or one of ${REPO_SCOPES.join(", ")} (${scopes.join(", ")})`,
      );
    }
  }
  if (/^[A-Z]/.test(subject)) problems.push("the subject must start lowercase");
  if (subject.endsWith(".")) problems.push("the subject must not end with a period");
  if (header.length > MAX_HEADER) problems.push(`the header is ${header.length} characters; keep it to ${MAX_HEADER}`);
  if (NEEDS_TEST.has(type) && !stagedFiles.some(isTestFile)) {
    problems.push(`a ${type} commit must include a test change (a *.test.* or *.spec.* file, or a file under e2e/)`);
  }
  return problems;
}

function gitStagedFiles(): string[] {
  const r = spawnSync("git", ["diff", "--cached", "--name-only", "-z"], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.split("\0").filter(Boolean) : [];
}

/**
 * The commit-msg git hook: reads the message file git passes, checks it against the staged files,
 * prints each problem, and returns the exit code, 0 to let the commit through and 1 to refuse it.
 */
export function runCommitMsgHook(
  messageFile: string,
  { stagedFiles = gitStagedFiles }: { stagedFiles?: () => string[] } = {},
): number {
  const problems = checkCommitMessage(fs.readFileSync(messageFile, "utf8"), { stagedFiles: stagedFiles() });
  if (problems.length === 0) return 0;
  console.error("commit-msg: the message was refused");
  for (const problem of problems) console.error(`  - ${problem}`);
  return 1;
}
