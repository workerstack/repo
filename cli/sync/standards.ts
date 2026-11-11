import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { PRINT_WIDTH } from "../lint/max-line-width.constants.ts";
import { repoBinLookup } from "../scripts/hook-command.ts";
import { canonicalPath } from "../scripts/workspace-root.ts";
import { GIT_FILE_PATHS, type PostPass } from "./git-files.ts";
import { hasOwnedHeader } from "./header.ts";
import { KNIP_CONFIG_PATH, knipConfig } from "./knip-config.ts";
import type { Output, SyncContext } from "./outputs.ts";
import { FIXTURES, OXLINT_CONFIG_PATH, oxlintConfig } from "./oxlint-config.ts";
import { CARGO_PATH } from "./rust.constants.ts";
import { EXECUTABLE_MODE, INDEX_FIELDS, WINDOWS_PLATFORM } from "./standards.constants.ts";

export const OXFMT_CONFIG_PATH = ".oxfmtrc.jsonc";
/** Where the git hooks live; sync points `core.hooksPath` here. */
const HOOKS_DIR = ".githooks";
/** Each git hook and the repo command it runs, with the arguments git passes. */
const GIT_HOOKS = {
  "commit-msg": 'commit-msg "$1"',
  "pre-commit": "turn --staged",
  "pre-push": "link --pre-push",
} as const;
const HOOK_PATHS = Object.keys(GIT_HOOKS).map((name) => `${HOOKS_DIR}/${name}`);

/**
 * The oxfmt config: width 120, package.json fields sorted (the other json files' keys are sorted by `repo fmt`),
 * imports grouped and sorted, Tailwind classes sorted (a no-op without class attributes), JSONC without trailing
 * commas, and no markdown, fixture or sync output touched; each output path is anchored at the root, so it matches that
 * file alone.
 */
function oxfmtConfig(planned: readonly string[]): string {
  const outputs = [
    ...new Set([...planned, ...GIT_FILE_PATHS, ...HOOK_PATHS, OXLINT_CONFIG_PATH, OXFMT_CONFIG_PATH, KNIP_CONFIG_PATH]),
  ].map((rel) => `/${rel}`);
  const config = {
    printWidth: PRINT_WIDTH,
    sortPackageJson: true,
    sortImports: {},
    sortTailwindcss: {},
    // Hand-written JSONC (hooks, MCP policy) is read by parsers that refuse a trailing comma.
    overrides: [{ files: ["**/*.jsonc"], options: { trailingComma: "none" } }],
    ignorePatterns: ["**/*.md", FIXTURES, ...outputs.sort()],
  };
  return `${JSON.stringify(config, null, 2)}\n`;
}

/**
 * The tracked, executable git hooks: each finds the bin from `.`, the worktree top level git runs hooks in, never from
 * an agent's project dir. A hook at either path without the generated header is the user's, so sync refuses it.
 */
function gitHooks(ctx: SyncContext): { outputs: Output[]; errors: string[] } {
  const outputs: Output[] = [];
  const errors: string[] = [];
  for (const [name, command] of Object.entries(GIT_HOOKS)) {
    const rel = `${HOOKS_DIR}/${name}`;
    const existing = ctx.read(rel);
    if (existing !== null && !hasOwnedHeader(existing)) {
      errors.push(`${rel} is hand-written; delete it so repo sync can own it`);
      continue;
    }
    const content = `#!/bin/sh\n${repoBinLookup(".")}\n"$r" ${command}\n`;
    outputs.push({ content, executable: true, kind: "file", managed: "whole", path: rel, tracked: true });
  }
  return errors.length > 0 ? { errors, outputs: [] } : { errors, outputs };
}

/**
 * Under the standards pack, `.oxlintrc.json` (with an override per `lint.skip` entry), `knip.json` (with the
 * `knip.ignore` entries) and `.oxfmtrc.jsonc`, all untracked and sync's own, and the git hooks; a hand-written hook or a skip of a rule the config never runs refuses all.
 * It runs after the generators so oxfmt can ignore every output, and before the git files pass, whose paths it names
 * itself and which marks the hooks generated.
 */
export const standards: PostPass = (ctx, outputs) => {
  if (!ctx.config.packs.includes("standards")) return { errors: [], outputs: [] };
  const file = (target: string, content: string): Output => ({
    content,
    kind: "file",
    managed: "whole",
    path: target,
    tracked: false,
  });
  const hooks = gitHooks(ctx);
  const oxlint = oxlintConfig(ctx.workspace, ctx.config.lint.skip, ctx.read(CARGO_PATH) !== null);
  const errors = [...hooks.errors, ...(oxlint.ok ? [] : oxlint.errors)];
  if (!oxlint.ok || errors.length > 0) return { errors, outputs: [] };
  return {
    errors: [],
    outputs: [
      file(OXLINT_CONFIG_PATH, oxlint.value),
      file(KNIP_CONFIG_PATH, knipConfig(ctx.workspace, ctx.config.knip.ignore)),
      file(OXFMT_CONFIG_PATH, oxfmtConfig(outputs.map((output) => output.path))),
      ...hooks.outputs,
    ],
  };
};

/** One git command run at a root, with `input` on its stdin; `status` is null when git could not start. */
export type GitRun = (
  root: string,
  args: readonly string[],
  input?: string,
) => { status: number | null; stdout: string; stderr: string };

/** Runs git at `root`; a git that cannot start is a null status with the reason as its stderr. */
export const runGit: GitRun = (root, args, input) => {
  const result = spawnSync("git", [...args], { cwd: root, encoding: "utf8", input });
  if (result.error) return { status: null, stderr: result.error.message, stdout: "" };
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
};

/** What the hooks path step did, for the summary line, and what it could not do, one line each. */
export type HooksPathResult = { done: string[]; warnings: string[] };

/**
 * Converges `core.hooksPath` on the pack, in a checkout whose top level is `root`: set to the hooks when unset and the
 * pack is on, unset when it is ours and the pack is off, and anything else left. A value pointing elsewhere while the
 * pack is on is reported on every run, never taken over, since the user put it there.
 */
export function syncHooksPath(root: string, on: boolean, git: GitRun = runGit): HooksPathResult {
  const none: HooksPathResult = { done: [], warnings: [] };
  const top = git(root, ["rev-parse", "--show-toplevel"]);
  if (top.status !== 0 || canonicalPath(top.stdout.trim()) !== canonicalPath(root)) return none;
  const change = (args: string[], what: string): HooksPathResult => {
    const result = git(root, ["config", ...args]);
    return result.status === 0
      ? { done: [what], warnings: [] }
      : { done: [], warnings: [`cannot ${what}: ${result.stderr.trim()}`] };
  };
  const got = git(root, ["config", "--show-scope", "--get", "core.hooksPath"]);
  if (got.status !== 0) return on ? change(["core.hooksPath", HOOKS_DIR], `set core.hooksPath to ${HOOKS_DIR}`) : none;
  const [scope, value] = got.stdout.trim().split("\t") as [string, string];
  if (value !== HOOKS_DIR) return on ? { done: [], warnings: [foreignLine(scope, value)] } : none;
  return on || scope !== "local" ? none : change(["--unset", "core.hooksPath"], "unset core.hooksPath");
}

/** Whether `git ls-files -s` fields are `mode sha stage path`. */
const isIndexRow = (fields: string[]): fields is [string, string, string, string] => fields.length === INDEX_FIELDS;

/** The mode and blob of each path in `git ls-files -s` output, by path; a line of another shape is left out. */
function indexEntries(listing: string): Map<string, { mode: string; sha: string }> {
  const entries = new Map<string, { mode: string; sha: string }>();
  for (const line of listing.split("\n")) {
    const fields = line.split(/[ \t]/, INDEX_FIELDS);
    if (!isIndexRow(fields)) continue;
    const [mode, sha, , rel] = fields;
    entries.set(rel, { mode, sha });
  }
  return entries;
}

/**
 * On win32 git cannot see an executable bit, so `git add` records the hooks as `100644` and a Unix clone cannot run
 * them. Sets the index mode of each hook sync wrote to `100755` (staging one git does not track yet), in a checkout
 * whose top level is `root`. Elsewhere the file mode carries it and this does nothing.
 */
export function markHooksExecutable(root: string, platform: string, git: GitRun = runGit): HooksPathResult {
  const none: HooksPathResult = { done: [], warnings: [] };
  if (platform !== WINDOWS_PLATFORM) return none;
  const top = git(root, ["rev-parse", "--show-toplevel"]);
  if (top.status !== 0 || canonicalPath(top.stdout.trim()) !== canonicalPath(root)) return none;
  const listed = git(root, ["ls-files", "-s", "--", ...HOOK_PATHS]);
  if (listed.status !== 0) return none;
  const entries = indexEntries(listed.stdout);
  const todo = HOOK_PATHS.filter(
    (rel) => entries.get(rel)?.mode !== EXECUTABLE_MODE && fs.existsSync(path.join(root, rel)),
  );
  if (todo.length === 0) return none;
  // A tracked hook keeps its staged blob (`--cacheinfo`); `--add` hashes the file as it is now, for one git has not seen.
  const results = todo.map((rel) => {
    const entry = entries.get(rel);
    return entry
      ? git(root, ["update-index", "--cacheinfo", `${EXECUTABLE_MODE},${entry.sha},${rel}`])
      : git(root, ["update-index", "--add", "--chmod=+x", "--", rel]);
  });
  const failed = results.find((result) => result.status !== 0);
  return failed === undefined
    ? { done: [`marked ${todo.join(", ")} executable in the index`], warnings: [] }
    : { done: [], warnings: [`cannot mark the git hooks executable: ${failed.stderr.trim()}`] };
}

/** The line for a `core.hooksPath` that points elsewhere, with the command that unsets it at its scope. */
function foreignLine(scope: string, value: string): string {
  const flag = scope === "local" ? "" : `--${scope} `;
  return `core.hooksPath is ${value}, so repo's hooks never run; unset it (git config ${flag}--unset core.hooksPath) and sync again`;
}
