import path from "node:path";

import { under } from "../docs.constants.ts";
import { refRow, walkRefMd } from "./maps-rows.ts";
import { INDEX_REL, REFS_REL } from "./maps.constants.ts";
import { regionBody, syntaxOf } from "./region.ts";

/** The `repo:refs` section body and one error per reference that has no usable description. */
export type RefsSection = { body: string; errors: string[] };

/**
 * The body of the `repo:refs` section of the references/INDEX.md of the package at `dir` under `root` (`""` for the
 * repo root), from one scan of its references: a line per file, lowest frontmatter `order` first, those without one
 * after, ties by path. The hand-written text of the index is never touched. Every reference whose description or order
 * is bad is named in `errors` by its path from the repo root.
 */
export function refsSection(root: string, dir: string): RefsSection {
  const base = under(dir, REFS_REL);
  const errors: string[] = [];
  const rows: { line: string; order: number; rel: string }[] = [];

  const files = walkRefMd(path.join(root, base), base, []).toSorted((a, b) => a.rel.localeCompare(b.rel));

  for (const file of files) {
    const row = refRow(file, base);

    if ("error" in row) errors.push(row.error);
    else rows.push({ line: row.line, order: row.order ?? Infinity, rel: file.rel });
  }

  const sorted = rows.toSorted((a, b) => (a.order === b.order ? a.rel.localeCompare(b.rel) : a.order - b.order));

  return { body: sorted.map((row) => row.line).join("\n"), errors };
}

/** The trimmed lines of the INDEX region `repo:<name>`, its markers read loosely, or null when the pair is missing. */
export function sectionBody(text: string, name: string): string[] | null {
  const body = regionBody(text, syntaxOf(INDEX_REL), name);

  if (body === undefined) return null;

  return body === "" ? [] : body.split("\n").map((l) => l.trimEnd());
}

const ROW_PATH = /^- `([^`]+)`/;

/** The paths under references/ that the `repo:refs` block of an INDEX text lists, in order. */
export function refPaths(text: string): string[] {
  return (sectionBody(text, "refs") ?? []).flatMap((line) => ROW_PATH.exec(line)?.[1] ?? []);
}
