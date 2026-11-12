/**
 * Where repo state lives for a hook or script call (roadmap D1, D2).
 *
 *   root      `.tmp/repo` scratch: the main checkout, so subdirs and worktrees share one
 *   checkout  tracked files (lessons, `cli/scripts`): the checkout the agent works in
 *   cwd       paths the agent typed and child-process cwds: the hook's cwd, else the sent workspace
 *
 * A repo install is the nearest dir holding INSTALL_MARKER, up to the git top level, so a
 * repo install in a subpackage keeps its own root. All three share the `realpath.native` spelling, so a
 * symlink, a junction or a Windows 8.3 short name compares equal to the path git prints. Node builtins only.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { repoEnv, type Env } from "../repo-env.ts";
import { GIT_DIR_NAME } from "./git-dir-name.constants.ts";
import type { HookInput } from "./hook-input.ts";

/**
 * The file that marks a repo install: the consumer's `workerstack.config.ts`, which also exists with no `agents/`
 * dir.
 */
export const INSTALL_MARKER = "workerstack.config.ts";

export type GitFacts = {
  top: string;
  gitDir: string;
  commonDir: string;
};

/** Root, checkout and cwd spellings for one hook or script call. */
export type Roots = {
  root: string;
  checkout: string;
  cwd: string;
};

type RootsContext = {
  git: (dir: string) => GitFacts | null;
  p: typeof path;
  exists: (abs: string) => boolean;
  realpath: (abs: string, p?: typeof path) => string;
};

const LINE_SPLIT_RE = /\r?\n/;

const revParseMemo = /* @__PURE__ */ new Map<string, GitFacts | null>();

/** A line git printed, not a missing or blank one. */
function isLine(line: string | undefined): line is string {
  return line !== undefined && line !== "";
}

/** The three lines `git rev-parse` printed as git facts, or null when one is missing. */
function factsOf(out: string): GitFacts | null {
  const [top, gitDir, commonDir] = out.split(LINE_SPLIT_RE);

  return isLine(top) && isLine(gitDir) && isLine(commonDir) ? { commonDir, gitDir, top } : null;
}

/** `{ top, gitDir, commonDir }` for `dir`, or null outside git. Memoized for this process only. */
export function gitRevParse(dir: string, run: typeof execFileSync = execFileSync): GitFacts | null {
  if (revParseMemo.has(dir)) return revParseMemo.get(dir) ?? null;
  let facts: GitFacts | null = null;

  try {
    const out = run(
      "git",
      ["-C", dir, "rev-parse", "--path-format=absolute", "--show-toplevel", "--git-dir", "--git-common-dir"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );

    facts = factsOf(out);
  } catch {
    facts = null;
  }

  revParseMemo.set(dir, facts);

  return facts;
}

/** The filesystem calls `canonicalPath` makes, replaceable by a test. */
type CanonicalEdges = {
  exists: (abs: string) => boolean;
  real: (abs: string) => string;
};

const NATIVE_EDGES: CanonicalEdges = { exists: fs.existsSync, real: fs.realpathSync.native };

/**
 * `abs` with its nearest existing ancestor in the `realpath.native` spelling. A relative path, a non-string, or a
 * path for a foreign `p` (a `path.win32` test on Linux) comes back unchanged.
 */
export function canonicalPath(abs: string, p: typeof path = path, edges: CanonicalEdges = NATIVE_EDGES): string {
  const { exists, real } = edges;

  if (p !== path || typeof abs !== "string" || !path.isAbsolute(abs)) return abs;
  let dir = abs;

  while (!exists(dir)) {
    const up = path.dirname(dir);

    if (up === dir) return abs;
    dir = up;
  }

  try {
    return path.join(real(dir), path.relative(dir, abs));
  } catch {
    return abs;
  }
}

/** A path an agent typed, resolved against the roots' cwd, in the roots' spelling. */
export function resolveTyped(roots: { cwd: string }, raw: string, p: typeof path = path): string {
  return canonicalPath(p.resolve(roots.cwd, raw), p);
}

function firstString(...values: unknown[]): string {
  for (const v of values) if (typeof v === "string" && v.trim() !== "") return v.trim();

  return "";
}

function asDir(value: string): string {
  return value.startsWith("file:") ? fileURLToPath(value) : value;
}

function within(p: typeof path, top: string, dir: string): boolean {
  const rel = p.relative(top, dir);

  return !rel.startsWith("..") && !p.isAbsolute(rel);
}

/** Nearest dir from `dir` up to the git top level that holds the repo marker, else that top level. */
function checkoutIn(dir: string, facts: GitFacts | null, { p, exists, realpath }: RootsContext): string {
  if (facts === null) return dir;
  const top = realpath(p.resolve(facts.top));

  if (!within(p, top, dir)) return top;

  for (let d = dir; ; d = p.dirname(d)) {
    if (exists(p.join(d, INSTALL_MARKER))) return d;

    if (d === top) return top;
  }
}

function rootsFor(start: string, ctx: RootsContext): { checkout: string; root: string } {
  const facts = ctx.git(start);
  const checkout = checkoutIn(start, facts, ctx);

  if (facts === null) return { checkout, root: checkout };
  const { p } = ctx;
  const gitDir = ctx.realpath(p.resolve(facts.gitDir));
  const commonDir = ctx.realpath(p.resolve(facts.commonDir));

  if (gitDir === commonDir || p.basename(commonDir) !== GIT_DIR_NAME) return { checkout, root: checkout };
  const main = p.dirname(commonDir);

  return { checkout, root: p.join(main, p.relative(ctx.realpath(p.resolve(facts.top)), checkout)) };
}

/** What `resolveRoots` may be handed in place of the process's own env, cwd, git and filesystem. */
type RootsOptions = Partial<RootsContext> & { env?: Env; cwd?: string };

/** The options with the process's own for each one left out. */
function contextOf(options: RootsOptions): RootsContext & { env: Env; cwd: string } {
  return {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? repoEnv.process,
    exists: options.exists ?? fs.existsSync,
    git: options.git ?? gitRevParse,
    p: options.p ?? path,
    realpath: options.realpath ?? canonicalPath,
  };
}

/** The workspace the harness sent: Grok's and Cursor's root, else Antigravity's first path; "" when none. */
function sentWorkspace(data: HookInput): string {
  const paths = Array.isArray(data.workspacePaths) ? data.workspacePaths : [];

  return firstString(data.workspaceRoot, data.workspace_root, paths[0]);
}

/** Resolves roots from a hook input; reads workspaceRoot, workspace_root, workspacePaths, cwd and toolCall.args.Cwd. */
export function resolveRoots(input: HookInput | null = {}, options: RootsOptions = {}): Roots {
  const data: HookInput = input !== null && typeof input === "object" ? input : {};
  const { env, cwd, ...ctx } = contextOf(options);
  const { p, realpath } = ctx;
  const args = data.toolCall?.args ?? {};
  const given = sentWorkspace(data);
  // A workspace the harness sent beats the hook process cwd as where the agent works.
  const typed = firstString(data.cwd, args.Cwd, given);
  const hookCwd = realpath(p.resolve(cwd, asDir(typed === "" ? "." : typed)));
  const candidate = firstString(given, env.GROK_WORKSPACE_ROOT, env.CLAUDE_PROJECT_DIR);
  const start = candidate === "" ? hookCwd : realpath(p.resolve(cwd, asDir(candidate)));

  return {
    checkout: rootsFor(hookCwd, ctx).checkout,
    cwd: hookCwd,
    root: rootsFor(start, ctx).root,
  };
}
