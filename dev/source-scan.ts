/**
 * What the dev source scans share: reading an oxc node, the line of each node a check matches, and the walk over every
 * TypeScript file in the checkout. Each scan only says which node it looks for.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseSync } from "oxc-parser";

import { asNode, isSyntaxList, type SyntaxNode, type SyntaxValue } from "../cli/syntax-node.ts";

const SOURCE_RE = /\.(?:ts|mts|cts|tsx)$/u;

/** `value[key]`, or undefined when `value` is no node. */
export function get(value: SyntaxValue, key: string): SyntaxValue {
  return asNode(value)?.[key];
}

/** Pushes the start offset of every node under `node` that `matches` onto `out`. */
function collect(node: SyntaxValue, matches: (found: SyntaxNode) => boolean, out: number[]): void {
  if (isSyntaxList(node)) {
    for (const child of node) collect(child, matches, out);

    return;
  }

  const found = asNode(node);

  if (found === null) return;

  if (matches(found)) out.push(Number(found["start"]));

  for (const child of Object.values(found)) collect(child, matches, out);
}

/**
 * The 1-based line of each node in `source` that `matches`; `rel` names the file, and its extension picks the parser.
 */
export function matchingLines(rel: string, source: string, matches: (found: SyntaxNode) => boolean): number[] {
  const starts: number[] = [];
  collect(asNode(parseSync(rel, source).program), matches, starts);

  return starts.map((at) => source.slice(0, at).split("\n").length);
}

/** Every `rel:line` that `scan` finds in the checkout's TypeScript files, tracked or new, `/` paths from the root. */
export function scanTree(scan: (rel: string, source: string) => number[]): string[] {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const listed = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { cwd: root, encoding: "utf8" });

  return listed
    .split("\n")
    .filter((rel) => SOURCE_RE.test(rel) && fs.existsSync(path.join(root, rel)))
    .flatMap((rel) => scan(rel, fs.readFileSync(path.join(root, rel), "utf8")).map((line) => `${rel}:${line}`));
}
