import path from "node:path";

import { refRow, walkRefMd } from "./maps-rows.ts";
import { INDEX_REL, REFS_REL } from "./maps.constants.ts";
import { regionBody, syntaxOf } from "./region.ts";

/** The `repo:refs` section body and one error per reference that has no usable description. */
export type RefsSection = { body: string; errors: string[] };

/**
 * The body of the `repo:refs` section of references/INDEX.md, from one scan of the references under `root`: a line
 * per file. Only this package keeps it; the hand-written text of the index is never touched. Every reference whose
 * description is missing or too long is named in `errors`.
 */
export function refsSection(root: string): RefsSection {
  const lines: string[] = [];
  const errors: string[] = [];

  const files = walkRefMd(path.join(root, REFS_REL), REFS_REL, []).toSorted((a, b) => a.rel.localeCompare(b.rel));

  for (const file of files) {
    const row = refRow(file);

    if ("error" in row) errors.push(row.error);
    else lines.push(row.line);
  }

  return { body: lines.join("\n"), errors };
}

/** The trimmed lines of the INDEX region `repo:<name>`, its markers read loosely, or null when the pair is missing. */
export function sectionBody(text: string, name: string): string[] | null {
  const body = regionBody(text, syntaxOf(INDEX_REL), name);

  if (body === undefined) return null;

  return body === "" ? [] : body.split("\n").map((l) => l.trimEnd());
}
