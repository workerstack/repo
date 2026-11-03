/**
 * Where grunt state lives for a hook or script call (roadmap D1, D2).
 *
 *   root      `.tmp/grunt` scratch: the main checkout, so subdirs and worktrees share one
 *   checkout  tracked files (lessons, `.rulesync/scripts`): the checkout the agent works in
 *   cwd       paths the agent typed and child-process cwds: the hook's cwd, else the sent workspace
 *
 * A grunt install is the nearest dir holding GRUNT_MARKER, up to the git top level, so a
 * grunt install in a subpackage keeps its own root. Node builtins only.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const GRUNT_MARKER = ".rulesync/scripts/workspace-root.mjs";

const revParseMemo = new Map();

/** `{ top, gitDir, commonDir }` for `dir`, or null outside git. Memoized for this process only. */
export function gitRevParse(dir) {
  if (revParseMemo.has(dir)) return revParseMemo.get(dir);
  let facts = null;
  try {
    const out = execFileSync(
      "git",
      ["-C", dir, "rev-parse", "--path-format=absolute", "--show-toplevel", "--git-dir", "--git-common-dir"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    const [top, gitDir, commonDir] = out.split(/\r?\n/);
    if (top && gitDir && commonDir) facts = { top, gitDir, commonDir };
  } catch {
    facts = null;
  }
  revParseMemo.set(dir, facts);
  return facts;
}

function realpathOr(abs) {
  try {
    return fs.realpathSync(abs);
  } catch {
    return abs;
  }
}

function firstString(...values) {
  for (const v of values) if (typeof v === "string" && v.trim()) return v.trim();
  return "";
}

function asDir(value) {
  return value.startsWith("file:") ? fileURLToPath(value) : value;
}

function within(p, top, dir) {
  const rel = p.relative(top, dir);
  return !rel.startsWith("..") && !p.isAbsolute(rel);
}

/** Nearest dir from `dir` up to the git top level that holds the grunt marker, else that top level. */
function checkoutIn(dir, facts, { p, exists }) {
  if (!facts) return dir;
  const top = p.resolve(facts.top);
  if (!within(p, top, dir)) return top;
  for (let d = dir; ; d = p.dirname(d)) {
    if (exists(p.join(d, GRUNT_MARKER))) return d;
    if (d === top) return top;
  }
}

function rootsFor(dir, ctx) {
  const start = ctx.realpath(dir);
  const facts = ctx.git(start);
  const checkout = checkoutIn(start, facts, ctx);
  if (!facts) return { checkout, root: checkout };
  const { p } = ctx;
  const gitDir = p.resolve(facts.gitDir);
  const commonDir = p.resolve(facts.commonDir);
  if (gitDir === commonDir || p.basename(commonDir) !== ".git") return { checkout, root: checkout };
  const main = p.dirname(commonDir);
  return { checkout, root: p.join(main, p.relative(p.resolve(facts.top), checkout)) };
}

/**
 * @param {object} [input] hook input; reads workspaceRoot, workspace_root, workspacePaths, cwd, toolCall.args.Cwd
 * @returns {{ root: string, checkout: string, cwd: string }}
 */
export function resolveRoots(
  input = {},
  { env = process.env, cwd = process.cwd(), git = gitRevParse, p = path, exists = fs.existsSync, realpath = realpathOr } = {},
) {
  const data = input && typeof input === "object" ? input : {};
  const args = data.toolCall && typeof data.toolCall === "object" && data.toolCall.args ? data.toolCall.args : {};
  const ctx = { git, p, exists, realpath };
  const paths = Array.isArray(data.workspacePaths) ? data.workspacePaths : [];
  const given = firstString(data.workspaceRoot, data.workspace_root, paths[0]);
  // A workspace the harness sent beats the hook process cwd as where the agent works.
  const hookCwd = p.resolve(cwd, asDir(firstString(data.cwd, args.Cwd, given) || "."));
  const candidate = firstString(given, env.GROK_WORKSPACE_ROOT, env.GEMINI_PROJECT_DIR, env.CLAUDE_PROJECT_DIR);
  const start = candidate ? p.resolve(cwd, asDir(candidate)) : hookCwd;
  return {
    root: rootsFor(start, ctx).root,
    checkout: rootsFor(hookCwd, ctx).checkout,
    cwd: hookCwd,
  };
}
