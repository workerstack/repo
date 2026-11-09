/**
 * The inputs every agent generator reads: stock `agents/` and the consumer's `.repo/` overlay, merged.
 * A `.repo/` rule or subagent replaces a stock one in place only when its frontmatter says `overrides: <name>`
 * (the stock path without `.md`, case-folded); a same-name file without it, or an `overrides` naming nothing, is a
 * problem. New files follow in path order. `.repo/hooks.jsonc` replaces the stock hooks whole.
 *
 * Frontmatter is user input, so it is checked here, once: a rule needs a `description` and may carry `paths` (a list
 * of strings); `overrides` is a string. Every problem is collected, never thrown one by one.
 */
import fs from "node:fs";
import path from "node:path";
import { stripJsonc } from "../../scripts/jsonc.ts";
import { type ParsedDoc, parseDoc } from "./frontmatter.ts";

/** One rule or subagent source file. */
export interface Doc extends ParsedDoc {
  /** POSIX path from its root, for messages: `agents/rules/overview.md`, `.repo/subagents/x/y.md`. */
  rel: string;
  /** POSIX path inside `rules/` or `subagents/`, which outputs are named after: `overview.md`, `x/y.md`. */
  file: string;
}

export interface HooksSource {
  rel: string;
  value: Record<string, unknown>;
}

export interface Sources {
  rules: Doc[];
  /** In merge order; subagents.ts re-sorts them shallowest-first as rulesync did. */
  subagents: Doc[];
  hooks: HooksSource;
}

/** Root-relative directory of each source root: stock first, the consumer overlay second. */
const STOCK_DIR = "agents";
const CONSUMER_DIR = ".repo";

/** The merged sources, or every problem found, each starting with the file it is about. */
export type LoadResult = { ok: true; sources: Sources } | { ok: false; problems: string[] };

type Kind = "rules" | "subagents";

/** Read and merge the sources. Bad frontmatter, ownership of a stock name and bad hooks JSONC are problems. */
export function loadSources(roots: { stockRoot: string; consumerRoot: string | null }): LoadResult {
  const tops = [
    { root: roots.stockRoot, dir: STOCK_DIR },
    ...(roots.consumerRoot === null ? [] : [{ root: roots.consumerRoot, dir: CONSUMER_DIR }]),
  ];
  const problems: string[] = [];
  const docs = (kind: Kind) => mergeDocs(kind, tops.map((top) => listDocs(top.root, top.dir, kind)), problems);
  const rules = docs("rules");
  const subagents = docs("subagents");
  const hooks = loadHooks(tops, problems);
  return problems.length > 0 || hooks === null ? { ok: false, problems } : { ok: true, sources: { rules, subagents, hooks } };
}

interface DocFile {
  abs: string;
  rel: string;
  file: string;
}

/** `<root>/<dir>/<kind>/**\/*.md` in plain string order of the POSIX path; dot entries skipped, symlinks followed. */
function listDocs(root: string, dir: string, kind: string): DocFile[] {
  const base = path.join(root, dir, kind);
  const found: DocFile[] = [];
  const walk = (abs: string, file: string) => {
    for (const name of fs.readdirSync(abs)) {
      if (name.startsWith(".")) continue;
      const child = path.join(abs, name);
      const childFile = file === "" ? name : `${file}/${name}`;
      if (fs.statSync(child).isDirectory()) walk(child, childFile);
      else if (name.endsWith(".md")) found.push({ abs: child, rel: `${dir}/${kind}/${childFile}`, file: childFile });
    }
  };
  if (fs.existsSync(base)) walk(base, "");
  // Paths in one root are unique, so the comparator never sees a tie.
  return found.sort((a, b) => (a.file < b.file ? -1 : 1));
}

const nameOf = (file: string) => file.replace(/\.md$/, "").toLowerCase();

/**
 * Stock files first, then each later root's: a file with `overrides: <name>` replaces the earlier file of that name
 * in place; a file whose own name is taken, or whose `overrides` names nothing, is a problem. Only the files that
 * survive are parsed.
 */
function mergeDocs(kind: Kind, perRoot: DocFile[][], problems: string[]): Doc[] {
  const singular = kind === "rules" ? "rule" : "subagent";
  const merged: (Doc | null)[] = [];
  const at = new Map<string, number>();
  const stockFiles = perRoot[0]!;
  const stockNames = new Set(stockFiles.map((file) => nameOf(file.file)));
  const replaced = new Set<string>();

  const parsed = perRoot.slice(1).flat().map((file) => ({ file, doc: read(kind, file, problems) }));
  for (const { file, doc } of parsed) {
    const overrides = doc?.data["overrides"];
    if (typeof overrides === "string" && stockNames.has(overrides.toLowerCase())) replaced.add(overrides.toLowerCase());
    else if (typeof overrides === "string") problems.push(`${file.rel}: overrides "${overrides}" but no stock ${singular} has that name`);
    else if (doc !== null && stockNames.has(nameOf(file.file))) {
      problems.push(`${file.rel}: a stock ${singular} has this name; add \`overrides: ${file.file.replace(/\.md$/, "")}\` or rename it`);
    }
  }

  const push = (doc: Doc, key: string) => {
    const index = at.get(key);
    if (index === undefined) at.set(key, merged.push(doc) - 1);
    else merged[index] = doc;
  };
  for (const file of stockFiles) {
    const key = nameOf(file.file);
    if (replaced.has(key)) {
      // The stock file is never read; its slot is held for the replacement.
      at.set(key, merged.push(null) - 1);
    } else {
      const doc = read(kind, file, problems);
      if (doc !== null) push(doc, key);
    }
  }
  for (const { file, doc } of parsed) {
    if (doc === null) continue;
    const overrides = doc.data["overrides"];
    push(doc, typeof overrides === "string" && replaced.has(overrides.toLowerCase()) ? overrides.toLowerCase() : nameOf(file.file));
  }
  return merged.filter((doc): doc is Doc => doc !== null);
}

/** Parse and check one file; a problem is recorded and `null` returned. */
function read(kind: Kind, file: DocFile, problems: string[]): Doc | null {
  let parsed: ParsedDoc;
  try {
    parsed = parseDoc(file.rel, fs.readFileSync(file.abs, "utf8"));
  } catch (error) {
    problems.push((error as Error).message);
    return null;
  }
  const bad = frontmatterProblem(kind, parsed.data);
  if (bad !== null) {
    problems.push(`${file.rel}: invalid frontmatter: ${bad}`);
    return null;
  }
  return { rel: file.rel, file: file.file, ...parsed };
}

function frontmatterProblem(kind: Kind, data: Record<string, unknown>): string | null {
  if (data["overrides"] !== undefined && typeof data["overrides"] !== "string") return "overrides must be a string";
  if (kind === "subagents") return null;
  if (typeof data["description"] !== "string" || data["description"].trim() === "") return "description is required";
  const paths = data["paths"];
  if (paths !== undefined && !(Array.isArray(paths) && paths.every((path) => typeof path === "string"))) {
    return "paths must be a list of strings";
  }
  return null;
}

/**
 * The last root with a `hooks.jsonc`; stock always counts, so a missing stock file fails the read.
 * `stripJsonc` drops comments only: trailing commas are unsupported. Returns `null` after recording a problem.
 */
function loadHooks(tops: { root: string; dir: string }[], problems: string[]): HooksSource | null {
  const top = tops.findLast((t, i) => i === 0 || fs.existsSync(path.join(t.root, t.dir, "hooks.jsonc")))!;
  const rel = `${top.dir}/hooks.jsonc`;
  const text = fs.readFileSync(path.join(top.root, rel), "utf8");
  let value: unknown;
  try {
    value = JSON.parse(stripJsonc(text));
  } catch (error) {
    problems.push(`${rel}: invalid JSONC: ${(error as Error).message}`);
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    problems.push(`${rel}: invalid JSONC: expected an object`);
    return null;
  }
  return { rel, value: value as Record<string, unknown> };
}
