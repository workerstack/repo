import fs from "node:fs";
import path from "node:path";

import { changelogProblems, type Kind } from "./commit-changelog.ts";
import {
  ATTRIBUTION,
  BREAKING_KEY,
  CAPITAL_START,
  FREE_BODY,
  KEBAB_SCOPE,
  KEY_VALUE,
  NEEDS_TEST,
  NOT_FOUND,
  ONE_WHY,
  REVERT_LINE,
} from "./commit-msg.constants.ts";
import { NAME_A_SOURCE, RANGE_ARGS, RANGE_FLAG } from "./commit-range.constants.ts";
import { commitRange } from "./commit-range.ts";
import { DEFAULT_MAX_CHANGED_LINES, findRoot, loadConfig } from "./config.ts";
import { BREAKING_FOOTER, HEADER, isBreaking, TYPES } from "./conventional.ts";
import { type NameStatus, parseNameStatus, redProof as realRedProof, type RedProofResult } from "./red-proof.ts";
import { scopesOf } from "./scopes-of.ts";
import { stagedChange } from "./staged-change.ts";
import { runGit } from "./sync/standards.ts";
import { readWorkspace } from "./sync/workspace.ts";
import { type Owner, ownerLookup, proofApplies } from "./tdd-scope.ts";
import { isTestFile } from "./test-files.ts";

/** Scopes every monorepo accepts besides its workspace package names. */
export const REPO_SCOPES: string[] = ["repo", "deps", "ci"];

const MAX_HEADER = 100;
/** The line above the diff `git commit --verbose` appends; everything from it down is not the message. */
const SCISSORS = "# ------------------------ >8 ------------------------";

/** What a message is checked against: the staged paths and changed lines, the limit, and the workspace's scopes. */
export type CommitFacts = {
  stagedFiles: string[];
  changedLines: number;
  maxChangedLines: number;
  scopes?: string[] | undefined;
};

/** What the repo's config and workspace set: the size limit, and the scopes of a monorepo. */
export type CommitRules = {
  maxChangedLines: number;
  scopes?: string[] | undefined;
  /** Whether a feat or fix is held to red-proof even in private packages. */
  tdd: boolean;
  /** The package owning a repo-relative file. */
  owners: (file: string) => Owner;
};
/** Where `repo commit-msg` runs and prints; `redProof` is the red-proof runner, replaceable in tests. */
export type CommitMsgIo = {
  cwd: string;
  stderr: (text: string) => void;
  redProof?: (root: string, change: NameStatus[]) => RedProofResult;
};

/** The scope problem, if any: kebab-case always, and one of `scopes` or the repo scopes when `scopes` is given. */
function scopeProblems(scope: string | undefined, scopes: string[] | undefined): string[] {
  if (scope === undefined) return [];
  if (!KEBAB_SCOPE.test(scope)) return [`the scope "${scope}" must be lowercase kebab-case`];
  if (scopes === undefined || scopes.includes(scope) || REPO_SCOPES.includes(scope)) return [];
  const known = `one of ${REPO_SCOPES.join(", ")} (${scopes.join(", ")})`;
  return [`unknown scope "${scope}"; use a workspace package name or ${known}`];
}

/** What the body holds: the refusals of its trailer and attribution lines, and its free lines, the why candidates. */
type Body = { problems: string[]; free: string[] };

/** The refusal of one body line, or null when the line is not a trailer, a `Breaking:` line or an attribution. */
function lineProblem(line: string): string | null {
  if (ATTRIBUTION.test(line)) return `remove the attribution "${line}"; the work is the author's`;
  if (BREAKING_KEY.test(line)) return `write "${line}" as a "BREAKING CHANGE: <what breaks>" footer`;
  if (KEY_VALUE.test(line))
    return `remove "${line}"; commits carry no Key: value lines (write a why as a plain sentence)`;
  return null;
}

/**
 * Sorts the body's lines: a BREAKING CHANGE footer with the non-blank lines under it, and git's revert line, pass; a
 * trailer, `Breaking:` line or attribution is refused wherever it stands; every other line is free text.
 */
function readBody(body: readonly string[]): Body {
  const problems: string[] = [];
  const free: string[] = [];
  let isInFooter = false;
  for (const raw of body) {
    const line = raw.trim();
    if (line === "" || BREAKING_FOOTER.test(line)) {
      isInFooter = line !== "";
      continue;
    }
    const problem = lineProblem(line);
    if (problem !== null) problems.push(problem);
    else if (!isInFooter && !REVERT_LINE.test(line)) free.push(line);
  }
  return { free, problems };
}

/** The free-text problem, if any: under the size limit the body holds none; over it, exactly one line says why. */
function sizeProblems(free: readonly string[], { changedLines, maxChangedLines }: CommitFacts): string[] {
  if (changedLines <= maxChangedLines) return free.length === 0 ? [] : [FREE_BODY];
  if (free.length === 1) return [];
  if (free.length > 1) return [ONE_WHY];
  return [
    `the commit changes ${changedLines} lines, over the limit of ${maxChangedLines}; ` +
      "add a body line saying why, or split it",
  ];
}

/** The lines of the message itself: no comment, and nothing from the verbose diff's scissors line down. */
function messageLines(message: string): string[] {
  const all = message.split("\n");
  const scissors = all.indexOf(SCISSORS);
  return (scissors === NOT_FOUND ? all : all.slice(0, scissors)).filter((line) => !line.startsWith("#"));
}

/** The groups HEADER captures: scope is optional, type and subject are not. */
type Header = { type: string; scope: string | undefined; subject: string };

/** What checking a message found: every problem, and the header's type and breaking mark when the header parsed. */
type Inspected = { problems: string[]; kind?: Kind };

/** Checks one message, keeping the header's type so the caller need not parse it again. */
function inspect(message: string, facts: CommitFacts): Inspected {
  const lines = messageLines(message);
  const at = lines.findIndex((line) => line.trim() !== "");
  const header = lines[at];
  if (header === undefined) return { problems: ["the commit message is empty"] };
  if (header.startsWith("Merge ")) return { problems: [] };

  const match = HEADER.exec(header);
  if (match === null) {
    return {
      problems: ['the header must be "type(scope)!: subject", e.g. "fix(paths): compare hook paths canonically"'],
    };
  }

  const { type, scope, subject } = match.groups /* HEADER always captures type and subject */ as Header;
  const problems: string[] = [];
  if (!TYPES.includes(type)) problems.push(`unknown type "${type}"; use one of ${TYPES.join(", ")}`);
  problems.push(...scopeProblems(scope, facts.scopes));
  if (CAPITAL_START.test(subject)) problems.push("the subject must start lowercase");
  if (subject.endsWith(".")) problems.push("the subject must not end with a period");
  if (header.length > MAX_HEADER) problems.push(`the header is ${header.length} characters; keep it to ${MAX_HEADER}`);
  if (NEEDS_TEST.includes(type) && !facts.stagedFiles.some(isTestFile))
    problems.push(`a ${type} commit must include a test change (a *.test.* or *.spec.* file, or a file under e2e/)`);

  const body = lines.slice(at + 1);
  const read = readBody(body);
  return {
    kind: { breaking: isBreaking(header, body), type },
    problems: [...problems, ...read.problems, ...sizeProblems(read.free, facts)],
  };
}

/**
 * Checks one commit message against the Conventional Commits rules and the size limit, and returns every problem it
 * finds, or an empty list when the message passes. Without `scopes` any kebab-case scope is accepted.
 */
export function checkCommitMessage(message: string, facts: CommitFacts): string[] {
  return inspect(message, facts).problems;
}

/** The limit and scopes for the repo at or above `cwd`: the defaults without a config, or the problems loading it. */
async function commitRules(cwd: string): Promise<CommitRules | string[]> {
  const root = findRoot(cwd);
  const owners = ownerLookup(cwd);
  if (root === null) return { maxChangedLines: DEFAULT_MAX_CHANGED_LINES, owners, tdd: false };
  const loaded = await loadConfig(root);
  if (!loaded.ok) return loaded.errors;
  const workspace = readWorkspace(root);
  if (!workspace.ok) return workspace.errors;
  const { tdd, commit } = loaded.config;
  return { maxChangedLines: commit.maxChangedLines, owners, scopes: scopesOf(workspace.workspace), tdd };
}

/** The red-proof result for the staged change, or null when it does not apply to it. */
function proveRed(rules: CommitRules, io: CommitMsgIo): RedProofResult | null {
  const diff = runGit(io.cwd, ["diff", "--cached", "--name-status", "--no-renames", "-z"]);
  const change = parseNameStatus(diff.stdout);
  return proofApplies(change, rules) ? (io.redProof ?? realRedProof)(io.cwd, change) : null;
}

/** Every problem with `message` against the staged change, and the red-proof result when it ran. */
function judge(
  message: string,
  rules: CommitRules,
  io: CommitMsgIo,
): { problems: string[]; proof: RedProofResult | null } {
  const staged = stagedChange(io.cwd);
  const facts = { ...rules, changedLines: staged.changedLines, stagedFiles: staged.files };
  const { problems, kind } = inspect(message, facts);
  const proof =
    kind !== undefined && problems.length === 0 && NEEDS_TEST.includes(kind.type) ? proveRed(rules, io) : null;
  if (kind !== undefined) problems.push(...changelogProblems(kind, staged.files, rules.owners));
  if (proof?.ok === false) problems.push(proof.problem);
  return { problems, proof };
}

/**
 * The commit-msg check of the message file at `messageFile` (relative to `io.cwd`, the repo top level git runs hooks
 * in) against the staged change and `rules`: prints each problem and returns 0 to let the commit through, 1 to refuse.
 * A passing feat or fix is then held to red-proof where it applies, which prints its line or refuses.
 */
export function runCommitMsgHook(messageFile: string, rules: CommitRules, io: CommitMsgIo): number {
  const message = fs.readFileSync(path.resolve(io.cwd, messageFile), "utf8");
  const { problems, proof } = judge(message, rules, io);
  if (problems.length > 0) {
    io.stderr(`commit-msg: the message was refused\n${problems.map((problem) => `  - ${problem}\n`).join("")}`);
    return 1;
  }
  if (proof?.ok === true) io.stderr(`${proof.line}\n`);
  return 0;
}

/**
 * `repo commit-msg <file>`, the commit-msg git hook, or `--range <base>..<head>` for the commits of a range:
 * `runCommitMsgHook` with the config's size limit and the workspace's scopes, or exit 1 with the reason when the file
 * is not named or the config is broken.
 */
export async function main(
  argv: string[],
  io: CommitMsgIo = { cwd: process.cwd(), stderr: (text) => process.stderr.write(text) },
): Promise<number> {
  const ranged = argv[0] === RANGE_FLAG && argv.length === RANGE_ARGS;
  const [file] = argv;
  if (file === undefined || (file === RANGE_FLAG ? !ranged : argv.length > 1)) {
    io.stderr(NAME_A_SOURCE);
    return 1;
  }
  const rules = await commitRules(io.cwd);
  if (Array.isArray(rules)) {
    for (const error of rules) io.stderr(`repo commit-msg: ${error}\n`);
    return 1;
  }
  return ranged
    ? commitRange(argv[1] /* the range follows the flag */ as string, { check: checkCommitMessage, rules }, io)
    : runCommitMsgHook(file, rules, io);
}
