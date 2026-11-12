/** The `repo job` command: finding the installed bin, building a job call, and reading one back. */
import fs from "node:fs";
import path from "node:path";

import { SHELL_META } from "./gate-harness.ts";
import { BUN, JOB_FLAG, JOB_FLAGS, JOB_WORD, QUERY_FLAG, REPO_WORD, RTK, STASH_FLAG } from "./gate.constants.ts";
import { canonicalPath, gitRevParse, resolveTyped, type Roots } from "./workspace-root.ts";

/** Blank runs that split a command into words. */
const BLANKS_RE = /\s+/;

/** The first blank of a command and everything after it, which leaves its first word. */
const AFTER_FIRST_WORD_RE = /\s[\s\S]*$/;

/** Every regex metacharacter, for `replaceAll` to escape. */
const REGEX_META_RE = /[.*+?^${}()|[\]\\]/g;

/** A Windows `.exe` suffix. */
const EXE_SUFFIX_RE = /\.exe$/;

/** The command a hook got, or "" when it is not a string. */
function commandText(command: unknown): string {
  return typeof command === "string" ? command : "";
}

/** POSIX single-quote so `, $, and \ stay literal. */
export function quoteQuery(q: unknown): string {
  return `'${String(q).replaceAll("'", "'\\''")}'`;
}

export type RepoBin = {
  bin: string;
  /** True when the bin is the main checkout's because the worktree has no install of its own. */
  fallback: boolean;
};

/** The first of `repo`, `repo.exe` that exists under `dir`'s `node_modules/.bin`. */
function installedBin(dir: string): string | undefined {
  const plain = path.join(dir, "node_modules", ".bin", REPO_WORD);

  return [plain, `${plain}.exe`].find((c) => fs.existsSync(c));
}

/**
 * The installed `repo` bin a hook runs, in the order `hookCommand` probes: the checkout, its toplevel, then the main
 * checkout of a linked worktree, each as `repo` then `repo.exe`. With no install anywhere it names the checkout's own
 * path. Absolute, because the rewritten command runs from the agent's cwd.
 */
export function resolveRepoBin(checkout: string, p: typeof path = path): RepoBin {
  const own = p.join(checkout, "node_modules", ".bin", REPO_WORD);

  // A foreign path flavor (a `path.win32` test on Linux) names no folder git or the disk can answer for.
  if (p !== path) return { bin: own, fallback: false };
  const facts = gitRevParse(checkout);
  const found = installedBin(checkout) ?? (facts === null ? undefined : installedBin(facts.top));

  if (found !== undefined) return { bin: found, fallback: false };
  const mainBin = facts === null ? undefined : installedBin(path.dirname(facts.commonDir));

  return mainBin === undefined ? { bin: own, fallback: false } : { bin: mainBin, fallback: true };
}

/** The installed `repo` bin for `checkout`; see `resolveRepoBin`. */
export function repoBin(checkout: string, p: typeof path = path): string {
  return resolveRepoBin(checkout, p).bin;
}

/** Bash eats unquoted backslashes, so a command an agent runs spells every path with forward slashes. */
export function shellPath(p: string): string {
  return p.split(path.sep).join("/");
}

export function jobCommand(workspaceRoot: string, args: string): string {
  return `${shellPath(repoBin(workspaceRoot))} ${JOB_WORD} ${args}`;
}

export function alreadyRtk(command: unknown): boolean {
  const first = commandText(command).trim().replace(AFTER_FIRST_WORD_RE, "");

  return first === RTK || first.endsWith(`/${RTK}`);
}

function escapeRe(s: string): string {
  return s.replaceAll(REGEX_META_RE, "\\$&");
}

export function stripFlagValue(cmd: unknown, flag: string): string {
  const f = escapeRe(flag);
  const val = `(?:"[^"]*"|'[^']*'|\\S+)`;

  return commandText(cmd)
    .replaceAll(new RegExp(`${f}=${val}`, "g"), `${flag}=_`)
    .replaceAll(new RegExp(`${f}\\s+${val}`, "g"), `${flag} _`);
}

/** True when `token` is the bare command `name` or a path ending in it, with POSIX or Windows separators. */
function isBin(token: string | undefined, name: string): boolean {
  return token === name || new RegExp(`[\\\\/]${name}(?:\\.exe)?$`).test(token ?? "");
}

/** The args after `job` when `parts[at]` is it, else null. */
function afterJob(parts: string[], at: number): string[] | null {
  const [word, ...rest] = parts.slice(at);

  return word === JOB_WORD ? rest : null;
}

/** True when `target` is the checkout's installed `repo` bin, both in their canonical spelling. */
function isRepoBin(target: string, roots: Roots, p: typeof path): boolean {
  const abs = resolveTyped(roots, target, p);
  const bin = canonicalPath(repoBin(roots.checkout, p), p).replace(EXE_SUFFIX_RE, "");

  return abs === bin || abs === `${bin}.exe`;
}

/**
 * Args after the job command, optionally behind `rtk`: `bun repo job` or `[bun] <checkout>/node_modules/.bin/repo job`.
 * A relative path resolves against the hook cwd, and both sides compare in their canonical spelling.
 */
function jobRest(command: unknown, roots: Roots | null | undefined, p: typeof path = path): string[] | null {
  const cmd = commandText(command).trim();

  if (cmd === "" || roots == null) return null;
  const parts = cmd.split(BLANKS_RE).filter(Boolean);
  const behindRtk = Number(isBin(parts[0], RTK));
  const viaBun = isBin(parts[behindRtk], BUN);
  const at = behindRtk + Number(viaBun);
  const target = parts[at];

  if (target === undefined) return null;

  if (viaBun && target === REPO_WORD) return afterJob(parts, at + 1);

  return isRepoBin(target, roots, p) ? afterJob(parts, at + 1) : null;
}

/** True when argv runs the workspace's job command (flags may be messy). */
export function isWorkspaceJobScript(
  command: unknown,
  roots: Roots | null | undefined,
  p: typeof path = path,
): boolean {
  return jobRest(command, roots, p) != null;
}

type ParsedJob = {
  job: string;
  hasQuery: boolean;
  hasStash: boolean;
};

/** One job arg as a flag and, for `--flag=value`, its inline value. */
function splitFlag(arg: string): { flag: string; inline: string | null } {
  if (!arg.startsWith("--") || !arg.includes("=")) return { flag: arg, inline: null };
  const eq = arg.indexOf("=");

  return { flag: arg.slice(0, eq), inline: arg.slice(eq + 1) };
}

/**
 * The job, and whether it names a query or a stash, from the args after `job`; null for a flag the job does not
 * take.
 */
function scanJobArgs(rest: string[]): ParsedJob | null {
  const found: ParsedJob = { hasQuery: false, hasStash: false, job: "" };

  for (let j = 0; j < rest.length; j++) {
    const { flag, inline } = splitFlag(String(rest[j]));

    if (!JOB_FLAGS.includes(flag)) return null;

    if (inline === null) j += 1;

    if (flag === JOB_FLAG) found.job = (inline ?? rest[j] ?? "").toLowerCase();
    found.hasQuery ||= flag === QUERY_FLAG;
    found.hasStash ||= flag === STASH_FLAG;
  }

  return found;
}

export function parseJobCommand(command: unknown, roots: Roots | null | undefined): ParsedJob | null {
  const cmd = commandText(command).trim();

  if (cmd === "" || roots == null) return null;

  if (SHELL_META.test(stripFlagValue(cmd, QUERY_FLAG))) return null;
  const rest = jobRest(cmd, roots);

  return rest === null ? null : scanJobArgs(rest);
}
