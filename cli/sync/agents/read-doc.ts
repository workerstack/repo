import fs from "node:fs";

import { frontmatterProblem } from "./frontmatter-problem.ts";
import { type ParsedDoc, parseDoc } from "./frontmatter.ts";
import type { Doc, DocFile, Kind } from "./sources.types.ts";
import { withVariant } from "./variants.ts";

/** Parse and check one file of `kind`; a problem is recorded in `problems` and `null` returned. */
export function readDoc(kind: Kind, file: DocFile, problems: string[]): Doc | null {
  let parsed: ParsedDoc;

  try {
    parsed = parseDoc(file.rel, fs.readFileSync(file.abs, "utf8"));

    if (file.variant !== undefined) parsed = { body: parsed.body, data: withVariant(parsed.data, file.variant) };
  } catch (error) {
    problems.push((error /* parseDoc and readFileSync throw only Error */ as Error).message);

    return null;
  }

  const bad = frontmatterProblem(kind, parsed);

  if (bad !== null) {
    problems.push(`${file.rel}: ${bad}`);

    return null;
  }

  return { file: file.file, origin: file.origin, rel: file.rel, scope: file.scope, ...parsed };
}
