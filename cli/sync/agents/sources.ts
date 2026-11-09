/**
 * The inputs every agent generator reads: stock `agents/` and the consumer's `.repo/` overlay, merged.
 * A `.repo/` rule or subagent whose case-folded path matches a stock one replaces it in place; new ones follow
 * in path order. `.repo/hooks.jsonc` replaces the stock hooks whole.
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

/** Read and merge the sources; throws an Error naming the file on bad frontmatter or hooks JSONC. */
export function loadSources(roots: { stockRoot: string; consumerRoot: string | null }): Sources {
  const tops = [
    { root: roots.stockRoot, dir: STOCK_DIR },
    ...(roots.consumerRoot === null ? [] : [{ root: roots.consumerRoot, dir: CONSUMER_DIR }]),
  ];
  const docs = (kind: "rules" | "subagents") => mergeDocs(tops.map((top) => listDocs(top.root, top.dir, kind)));
  return { rules: docs("rules"), subagents: docs("subagents"), hooks: loadHooks(tops) };
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

/** Later roots replace a case-folded match in place; new files append in their root's order. */
function mergeDocs(perRoot: DocFile[][]): Doc[] {
  const merged: DocFile[] = [];
  const at = new Map<string, number>();
  for (const files of perRoot) {
    for (const doc of files) {
      const key = doc.file.toLowerCase();
      const index = at.get(key);
      if (index === undefined) at.set(key, merged.push(doc) - 1);
      else merged[index] = doc;
    }
  }
  return merged.map((doc) => ({ rel: doc.rel, file: doc.file, ...parseDoc(doc.rel, fs.readFileSync(doc.abs, "utf8")) }));
}

/**
 * The last root with a `hooks.jsonc`; stock always counts, so a missing stock file fails the read.
 * `stripJsonc` drops comments only: trailing commas are unsupported.
 */
function loadHooks(tops: { root: string; dir: string }[]): HooksSource {
  const top = tops.findLast((t, i) => i === 0 || fs.existsSync(path.join(t.root, t.dir, "hooks.jsonc")))!;
  const rel = `${top.dir}/hooks.jsonc`;
  const text = fs.readFileSync(path.join(top.root, rel), "utf8");
  let value: unknown;
  try {
    value = JSON.parse(stripJsonc(text));
  } catch (error) {
    throw new Error(`${rel}: invalid JSONC: ${(error as Error).message}`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${rel}: invalid JSONC: expected an object`);
  }
  return { rel, value: value as Record<string, unknown> };
}
