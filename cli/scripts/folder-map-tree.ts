/** The folder map's tree: raw folders from file paths, display rows, and their text at a depth that fits. */
import fs from "node:fs";
import path from "node:path";

import {
  CHARS_PER_TOKEN,
  DEFAULTS,
  FOLD_SHOWN,
  GO_MOD,
  MANIFESTS,
  PACKAGE_JSON,
  TOP_DIR,
} from "./folder-map.constants.ts";
import type { MapConfig, RenderFit, Row, RowTextOptions, TreeFilter, TreeNode, TreePlace } from "./folder-map.types.ts";
import { isRecord } from "./hook-input.ts";

/** `*` = one segment, `**` = any depth; matches the dir and everything under it. */
function globRe(glob: string): RegExp {
  const body = String(glob)
    .replace(/\/+$/, "")
    .split("**")
    .map((part) => part.replaceAll(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", "[^/]*"))
    .join(".*");
  return new RegExp(`^${body}(/|$)`);
}

function packageName(root: string, dir: string, manifest: string): string {
  try {
    const text = fs.readFileSync(path.join(root, dir, manifest), "utf8");
    if (manifest === PACKAGE_JSON) {
      const pkg: unknown = JSON.parse(text);
      return isRecord(pkg) && typeof pkg.name === "string" ? pkg.name : "";
    }
    if (manifest === GO_MOD) return (text.match(/^module\s+(\S+)/m) ?? [])[1] || "";
    return (text.match(/^name\s*=\s*"([^"]+)"/m) ?? [])[1] || "";
  } catch {
    return "";
  }
}

/** The manifest each package dir holds, the first one listed winning. */
function manifestsOf(files: string[]): Map<string, string> {
  const manifests = new Map<string, string>();
  for (const f of files) {
    const base = path.posix.basename(f);
    if (MANIFESTS.includes(base) && !manifests.has(path.posix.dirname(f))) manifests.set(path.posix.dirname(f), base);
  }
  return manifests;
}

/** The dir segments of a kept file, or null when the filter drops it. */
function keptSegs(f: string, filter: TreeFilter): string[] | null {
  const dir = path.posix.dirname(f);
  if (dir === TOP_DIR || filter.exclude.some((re) => re.test(dir))) return null;
  const segs = dir.split("/");
  if (filter.include.some((re) => re.test(dir))) return segs;
  if (!filter.code.test(f) || segs.some((s) => s.startsWith(".") || filter.skip.has(s))) return null;
  return segs;
}

/** The kid `s` of `node`, added with its package name when it is new. */
function childOf(node: TreeNode, s: string, place: TreePlace): TreeNode {
  const known = node.kids.get(s);
  if (known) return known;
  const p = node.path ? `${node.path}/${s}` : s;
  const m = place.manifests.get(p);
  const next: TreeNode = {
    kids: new Map<string, TreeNode>(),
    name: s,
    own: false,
    path: p,
    pkg: m ? packageName(place.root, p, m) : null,
  };
  node.kids.set(s, next);
  return next;
}

/**
 * Raw tree from file paths. Node: { name, path, kids: Map, own, pkg }.
 * `own` = holds a kept file directly. `pkg` is the package name ("" when
 * unnamed) on package roots, else null.
 */
export function buildTree(root: string, files: string[], opts: Partial<MapConfig> = {}): TreeNode {
  const o = { ...DEFAULTS, ...opts };
  const filter: TreeFilter = {
    code: new RegExp(`\\.(${o.codeExt.join("|")})$`),
    exclude: o.exclude.map(globRe),
    include: o.include.map(globRe),
    skip: new Set(o.skip),
  };
  const place: TreePlace = { manifests: manifestsOf(files), root };
  const top: TreeNode = { kids: new Map(), name: "", own: false, path: "", pkg: null };
  for (const f of files) {
    const segs = keptSegs(f, filter);
    if (segs === null) continue;
    let node = top;
    for (const s of segs) node = childOf(node, s, place);
    node.own = true;
  }
  return top;
}

const byName = (a: TreeNode, b: TreeNode): number => Number(a.name > b.name) - Number(a.name < b.name);

/** `k` with its pass-through dirs collapsed: one kid, no package and no code of its own. */
function collapsed(k: TreeNode, label: string): { node: TreeNode; label: string } {
  const through = k.kids.size === 1 && k.pkg == null && !k.own;
  for (const only of through ? k.kids.values() : []) return collapsed(only, `${label}/${only.name}`);
  return { label, node: k };
}

/**
 * Display tree: chains collapsed, leaf dirs folded.
 * Row: { kind: "dir"|"fold", label, path, pkg, kids: Row[] }.
 */
export function displayRows(node: TreeNode, opts: Partial<MapConfig> = {}): Row[] {
  const o = { ...DEFAULTS, ...opts };
  const kids = [...node.kids.values()].sort(byName);
  const leaves = kids.filter((k) => k.kids.size === 0 && k.pkg == null).map((k) => k.name);
  const folded = leaves.length >= o.foldAt ? new Set(leaves) : new Set<string>();
  const rows: Row[] = [];
  if (folded.size) rows.push({ kids: [], kind: "fold", label: leaves, path: node.path, pkg: null });

  for (const kid of kids) {
    if (folded.has(kid.name)) continue;
    // Collapse pass-through dirs only; a dir with its own code stays a row.
    const { node: k, label } = collapsed(kid, kid.name);
    rows.push({ kids: displayRows(k, o), kind: "dir", label, path: k.path, pkg: k.pkg });
  }
  return rows;
}

/** One row's line at `depth`: a fold names its first leaf dirs, a package row its name and full path. */
export function rowText(row: Row, depth: number, { more = false, base = "" }: RowTextOptions = {}): string {
  const pad = "  ".repeat(depth);
  if (row.kind === "fold") {
    const shown = row.label.slice(0, FOLD_SHOWN).join(", ");
    return `${pad}(${row.label.length} leaf dirs: ${shown}${row.label.length > FOLD_SHOWN ? ", …" : ""})`;
  }
  const full = base ? `${base}/${row.path}` : row.path;
  let line = `${pad}${row.label}/`;
  if (row.pkg != null) line += row.pkg ? `  # ${row.pkg}  ${full}` : `  # ${full}`;
  if (more) line += "  …";
  return line;
}

/** The token estimate of `text`. */
export function tokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** True when a package root sits anywhere below `row`. */
function holdsPackage(row: Row): boolean {
  return row.kids.some((k) => k.pkg != null || holdsPackage(k));
}

/**
 * Render rows with every package expanded to `cap` levels below its root
 * (top-level non-package rows count from 1). A row past the cap hides its
 * kids and ends in `…`, unless a package root sits below it: package rows
 * always stay reachable, and their own depth restarts at 0.
 */
function renderAtDepth(rows: Row[], cap: number, base: string): string[] {
  const lines: string[] = [];
  const walk = (list: Row[], depth: number, pkgDepth: number): void => {
    for (const row of list) {
      const rel = row.pkg == null ? pkgDepth : 0;
      const hidden = row.kids.length > 0 && rel >= cap && !holdsPackage(row);
      lines.push(rowText(row, depth, { base, more: hidden }));
      if (!hidden) walk(row.kids, depth + 1, rel + 1);
    }
  };
  walk(rows, 0, 1);
  return lines;
}

/** The lines at the deepest cap (from `fit.cap` down to 1) whose text fits the limit, and that depth. */
export function renderToFit(rows: Row[], fit: RenderFit): { lines: string[]; depth: number } {
  let lines: string[] = [];
  let depth = fit.cap;
  for (; depth >= 1; depth--) {
    lines = renderAtDepth(rows, depth, fit.base);
    if (lines.join("\n").length + 1 <= fit.limit) break;
  }
  return { depth: Math.max(depth, 1), lines };
}
