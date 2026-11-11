/**
 * The inputs every agent generator reads: stock `agents/` and the consumer's `.repo/` overlay, merged.
 * A `.repo/` rule or subagent replaces a stock one in place only when its frontmatter says `overrides: <name>`
 * (the stock path without `.md`, case-folded); a same-name file without it, or an `overrides` naming nothing, is a
 * problem. New files follow in path order. `.repo/hooks.jsonc` replaces the stock hooks whole.
 * Every problem is collected, never thrown one by one.
 */
import fs from "node:fs";
import path from "node:path";

import { stripJsonc } from "../../scripts/strip-jsonc.ts";
import { listDocs } from "./list-docs.ts";
import { mergeDocs } from "./merge-docs.ts";
import { readDoc } from "./read-doc.ts";
import { CONSUMER_DIR, HOOKS_FILE, RULES, STOCK_DIR } from "./sources.constants.ts";
import type { Doc, HooksSource, Kind, LoadResult } from "./sources.types.ts";

/** Where the sources live: the stock package, the consumer (none in this repo) and its workspace package dirs. */
export type SourceRoots = {
  stockRoot: string;
  consumerRoot: string | null;
  packages: readonly string[];
};

type Top = { dir: string; origin: Doc["origin"]; root: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The last root with a `hooks.jsonc`; stock always counts, so a missing stock file fails the read.
 * `stripJsonc` drops comments only: trailing commas are unsupported. A failure is recorded as a problem and the
 * hooks left empty.
 */
function loadHooks(stock: Top, tops: readonly Top[], problems: string[]): HooksSource {
  const top = tops.findLast(
    (t) => t === stock || fs.existsSync(path.join(t.root, t.dir, HOOKS_FILE)),
  ) /* stock always matches */ as Top;
  const rel = `${top.dir}/${HOOKS_FILE}`;
  const text = fs.readFileSync(path.join(top.root, rel), "utf8");
  let value: unknown;
  try {
    value = JSON.parse(stripJsonc(text));
  } catch (error) {
    problems.push(`${rel}: invalid JSONC: ${(error /* JSON.parse throws only SyntaxError */ as Error).message}`);
    return { rel, value: {} };
  }
  if (isObject(value)) return { rel, value };
  problems.push(`${rel}: invalid JSONC: expected an object`);
  return { rel, value: {} };
}

/** Each package's `.repo/rules`, in package order; `overrides` there is a problem and leaves the rule out. */
function packageRules(roots: SourceRoots, problems: string[]): Doc[] {
  const packageRoot = roots.consumerRoot ?? roots.stockRoot;
  const lists = roots.packages.map((dir) =>
    listDocs({ dir: `${dir}/${CONSUMER_DIR}`, kind: RULES, origin: "repo", root: packageRoot, scope: dir }),
  );
  return lists.flatMap((files) =>
    files.flatMap((file) => {
      const doc = readDoc(RULES, file, problems);
      if (doc?.data["overrides"] === undefined) return doc === null ? [] : [doc];
      problems.push(`${file.rel}: overrides has no meaning in a package rule; remove it`);
      return [];
    }),
  );
}

/**
 * Read and merge the sources. Bad frontmatter, ownership of a stock name and bad hooks JSONC are problems, collected
 * beside what loaded. `packages` are workspace package dirs (root-relative), read from `consumerRoot` (or `stockRoot`
 * when there is none, as in this repo): each one's `.repo/rules` loads after the merged root rules, in the order
 * given, never merged by name and never overriding; `overrides` there is a problem. Anything else in a package
 * `.repo/` is for `repoDirProblems` to refuse.
 */
export function loadSources(roots: SourceRoots): LoadResult {
  const stock: Top = { dir: STOCK_DIR, origin: "stock", root: roots.stockRoot };
  const consumer: Top[] =
    roots.consumerRoot === null ? [] : [{ dir: CONSUMER_DIR, origin: "repo", root: roots.consumerRoot }];
  const tops = [stock, ...consumer];
  const problems: string[] = [];
  function docs(kind: Kind): Doc[] {
    const perRoot = tops.map((top) => listDocs({ dir: top.dir, kind, origin: top.origin, root: top.root, scope: "" }));
    return mergeDocs({ kind, perRoot, problems });
  }
  // Package rules are read first, so their problems come first.
  const ownRules = packageRules(roots, problems);
  const rules = [...docs(RULES), ...ownRules];
  const subagents = docs("subagents");
  const hooks = loadHooks(stock, tops, problems);
  return { problems, sources: { hooks, rules, subagents } };
}
