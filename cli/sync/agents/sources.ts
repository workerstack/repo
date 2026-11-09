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
import { TARGET } from "./subagents.ts";

/** One rule or subagent source file. */
export interface Doc extends ParsedDoc {
  /** POSIX path from its root, for messages: `agents/rules/overview.md`, `.repo/subagents/x/y.md`. */
  rel: string;
  /** POSIX path inside `rules/` or `subagents/`, which outputs are named after: `overview.md`, `x/y.md`. */
  file: string;
  /** `stock` for the installed package's `agents/`, `repo` for anything under a `.repo/`, root or package. */
  origin: "stock" | "repo";
  /** `""` for stock and the root `.repo/`; the package dir (`packages/web`) for a package's `.repo/`. */
  scope: string;
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

/**
 * The docs that loaded and every problem found, each starting with the file it is about. A doc with a problem is left
 * out of `sources`, and so is a hooks file that failed (its `value` is then empty); a load with problems is not to be rendered.
 */
export interface LoadResult {
  sources: Sources;
  problems: string[];
}

type Kind = "rules" | "subagents";

/**
 * Read and merge the sources. Bad frontmatter, ownership of a stock name and bad hooks JSONC are problems, collected beside what loaded.
 * `packages` are workspace package dirs (root-relative), read from `consumerRoot` (or `stockRoot` when there is none, as in
 * this repo): each one's `.repo/rules` loads after the merged root rules, in the order given, never merged by name and never
 * overriding; `overrides` there is a problem. Anything else in a package `.repo/` is for `repoDirProblems` to refuse.
 */
export function loadSources(roots: { stockRoot: string; consumerRoot: string | null; packages: readonly string[] }): LoadResult {
  const tops = [
    { root: roots.stockRoot, dir: STOCK_DIR, origin: "stock" as const },
    ...(roots.consumerRoot === null ? [] : [{ root: roots.consumerRoot, dir: CONSUMER_DIR, origin: "repo" as const }]),
  ];
  const problems: string[] = [];
  const docs = (kind: Kind) => mergeDocs(kind, tops.map((top) => listDocs(top.root, top.dir, kind, top.origin, "")), problems);
  const packageRoot = roots.consumerRoot ?? roots.stockRoot;
  const packageRules = roots.packages.flatMap((dir) =>
    listDocs(packageRoot, `${dir}/${CONSUMER_DIR}`, "rules", "repo", dir).flatMap((file) => {
      const doc = read("rules", file, problems);
      if (doc?.data["overrides"] !== undefined) {
        problems.push(`${file.rel}: overrides has no meaning in a package rule; remove it`);
        return [];
      }
      return doc === null ? [] : [doc];
    }),
  );
  const rules = [...docs("rules"), ...packageRules];
  const subagents = docs("subagents");
  const hooks = loadHooks(tops, problems);
  return { sources: { rules, subagents, hooks }, problems };
}

interface DocFile {
  abs: string;
  rel: string;
  file: string;
  origin: Doc["origin"];
  scope: string;
}

/** `<root>/<dir>/<kind>/**\/*.md` in plain string order of the POSIX path; dot entries skipped, symlinks followed. */
function listDocs(root: string, dir: string, kind: string, origin: Doc["origin"], scope: string): DocFile[] {
  const base = path.join(root, dir, kind);
  const found: DocFile[] = [];
  const walk = (abs: string, file: string) => {
    for (const name of fs.readdirSync(abs)) {
      if (name.startsWith(".")) continue;
      const child = path.join(abs, name);
      const childFile = file === "" ? name : `${file}/${name}`;
      if (fs.statSync(child).isDirectory()) walk(child, childFile);
      else if (name.endsWith(".md")) found.push({ abs: child, rel: `${dir}/${kind}/${childFile}`, file: childFile, origin, scope });
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
  const bad = frontmatterProblem(kind, parsed);
  if (bad !== null) {
    problems.push(`${file.rel}: ${bad}`);
    return null;
  }
  return { rel: file.rel, file: file.file, origin: file.origin, scope: file.scope, ...parsed };
}

const RULE_KEYS = ["description", "paths", "overrides"];
const SUBAGENT_KEYS = ["name", "description", "targets", "overrides", "tier", "exec", ...Object.values(TARGET)];
/** The most a rule or subagent body may hold; longer detail belongs in a skill or a reference. */
const MAX_BODY_BYTES = 8 * 1024;

/** What is wrong with `parsed`, or null: unknown keys, bad value types, an empty or oversized body. */
function frontmatterProblem(kind: Kind, { data, body }: ParsedDoc): string | null {
  const keys = kind === "rules" ? RULE_KEYS : SUBAGENT_KEYS;
  const unknown = Object.keys(data).find((key) => !keys.includes(key));
  if (unknown !== undefined) return `unknown frontmatter key "${unknown}"; use ${keys.join(", ")}`;
  if (data["overrides"] !== undefined && typeof data["overrides"] !== "string") return "invalid frontmatter: overrides must be a string";
  if (kind === "rules") {
    if (typeof data["description"] !== "string" || data["description"].trim() === "") return "invalid frontmatter: description is required";
    const paths = data["paths"];
    if (paths !== undefined && !(Array.isArray(paths) && paths.every((path) => typeof path === "string"))) {
      return "invalid frontmatter: paths must be a list of strings";
    }
  }
  if (body.trim() === "") return "body is empty; write the instructions below the frontmatter";
  const bytes = Buffer.byteLength(body);
  if (bytes > MAX_BODY_BYTES) return `body is ${bytes} bytes, over the 8 KiB (${MAX_BODY_BYTES} byte) limit; move detail into a skill or a reference`;
  return null;
}

/**
 * The last root with a `hooks.jsonc`; stock always counts, so a missing stock file fails the read.
 * `stripJsonc` drops comments only: trailing commas are unsupported. A failure is recorded as a problem and the hooks left empty.
 */
function loadHooks(tops: { root: string; dir: string }[], problems: string[]): HooksSource {
  const top = tops.findLast((t, i) => i === 0 || fs.existsSync(path.join(t.root, t.dir, "hooks.jsonc")))!;
  const rel = `${top.dir}/hooks.jsonc`;
  const text = fs.readFileSync(path.join(top.root, rel), "utf8");
  let value: unknown;
  try {
    value = JSON.parse(stripJsonc(text));
  } catch (error) {
    problems.push(`${rel}: invalid JSONC: ${(error as Error).message}`);
    return { rel, value: {} };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    problems.push(`${rel}: invalid JSONC: expected an object`);
    return { rel, value: {} };
  }
  return { rel, value: value as Record<string, unknown> };
}
