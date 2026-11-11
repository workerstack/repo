#!/usr/bin/env bun
/**
 * Code-only folder map for agents. Folders, never files.
 *
 * Source: git ls-files (tracked + untracked, gitignore applied). A folder is
 * shown when it or a descendant holds a code file and no segment is skipped.
 * Package roots (package.json, go.mod, Cargo.toml, pyproject.toml) carry
 * `# name  path`. Single-child chains collapse; plain leaf dirs fold at foldAt.
 * Depth is uniform per package: the deepest level that fits the size limit;
 * deeper folders end in `…`.
 *
 *   bun repo map [dir]
 */
import path from "node:path";

import { listFiles, loadMapConfig, repoPrefix, repoRoot } from "./folder-map-config.ts";
import { buildTree, displayRows, renderToFit, tokens } from "./folder-map-tree.ts";
import { CHARS_PER_TOKEN } from "./folder-map.constants.ts";
import type { FolderMapResult, MapOptions } from "./folder-map.types.ts";

/** The files under `scope`, relative to it; all of them at the top. */
function scopedFiles(files: string[], scope: string): string[] {
  if (!scope) return files;
  return files.filter((f) => f.startsWith(`${scope}/`)).map((f) => f.slice(scope.length + 1));
}

/**
 * Map text for `root` (any dir inside a git repo), scoped to `dir` when set.
 * Depth is uniform: the deepest cap (≤ depthCap) whose text fits the limit,
 * where limit = budget × 4 chars, lowered by `opts.maxChars` (hook caps).
 * Returns { text, rows, tokens, depth } or null outside git.
 */
export function folderMap({
  root,
  dir = "",
  ...opts
}: MapOptions & { root: string; dir?: string }): FolderMapResult | null {
  const top = repoRoot(root);
  if (!top) return null;
  const files = listFiles(top);
  if (!files) return null;
  const o = { ...loadMapConfig(top), ...opts };
  const scope = dir ? repoPrefix(path.resolve(root, dir)) : "";
  if (scope == null) return { depth: 0, rows: 0, text: "", tokens: 0 };
  const rows = displayRows(buildTree(scope ? path.join(top, scope) : top, scopedFiles(files, scope), o), o);
  const limit = Math.min(o.budget * CHARS_PER_TOKEN, o.maxChars ?? Infinity);
  const { lines, depth } = renderToFit(rows, { base: scope, cap: o.depthCap, limit });
  const text = lines.length ? `${lines.join("\n")}\n` : "";
  return { depth, rows: lines.length, text, tokens: tokens(text) };
}

/** Text for `bun repo map [dir]` run from `cwd`. */
export function mapCommand(cwd: string, dir = ""): string {
  const out = folderMap({ dir, root: cwd });
  if (!out) return "repo map: not a git repository\n";
  return out.text || "repo map: no code folders\n";
}
