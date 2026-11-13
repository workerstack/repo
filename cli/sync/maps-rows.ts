import fs from "node:fs";
import path from "node:path";

import { isString } from "../json.ts";
import { parseDoc } from "./agents/frontmatter.ts";
import { DESC_MAX, REFS_REL, SKIP_REF_NAMES } from "./maps.constants.ts";

/** A reference file: its path and its path relative to the root. */
type RefFile = {
  abs: string;
  rel: string;
};

/** The frontmatter `description:` of the file `rel` with text `src`; `""` when there is none or it does not parse. */
function descriptionOf(rel: string, src: string): string {
  try {
    const { description } = parseDoc(rel, src).data;

    return isString(description) ? description.trim() : "";
  } catch {
    return "";
  }
}

/** The `.md` files under `dir`, dot entries and skipped names left out, appended to `acc` with `relBase` paths. */
export function walkRefMd(dir: string, relBase: string, acc: RefFile[]): RefFile[] {
  let entries: fs.Dirent[];

  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }

  for (const ent of entries) {
    if (ent.name.startsWith(".")) continue;
    const abs = path.join(dir, ent.name);
    const rel = `${relBase}/${ent.name}`;

    if (ent.isDirectory()) walkRefMd(abs, rel, acc);
    else if (ent.isFile() && ent.name.endsWith(".md") && !SKIP_REF_NAMES.has(ent.name)) acc.push({ abs, rel });
  }

  return acc;
}

/**
 * The INDEX line of a reference file: its path under references/ in a code span, then its frontmatter `description:`.
 * A missing, multi-line or over `DESC_MAX` characters description gives the error naming the file instead.
 */
export function refRow(file: RefFile): { line: string } | { error: string } {
  const description = descriptionOf(file.rel, fs.readFileSync(file.abs, "utf8"));

  if (description === "" || description.length > DESC_MAX || description.includes("\n"))
    return { error: `${file.rel}: description: missing or over ${DESC_MAX} characters` };

  return { line: `- \`${file.rel.slice(REFS_REL.length + 1)}\`: ${description}` };
}
