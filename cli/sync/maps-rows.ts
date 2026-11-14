import fs from "node:fs";
import path from "node:path";

import { type JsonObject, isNumber, isString } from "../json.ts";
import { parseDoc } from "./agents/frontmatter.ts";
import { DESC_MAX, SKIP_REF_NAMES, orderError } from "./maps.constants.ts";

/** A reference file: its path and its path relative to the root. */
type RefFile = {
  abs: string;
  rel: string;
};

/** The frontmatter of the file `rel` with text `src`; empty when there is none or it does not parse. */
function frontmatterOf(rel: string, src: string): JsonObject {
  try {
    return parseDoc(rel, src).data;
  } catch {
    return {};
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
 * The INDEX line of a reference file: its path under `base` in a code span, then its frontmatter `description:`, and
 * its frontmatter `order:`, a whole number or none. A missing, multi-line or over `DESC_MAX` characters description,
 * or an `order` that is not a whole number, gives the error naming the file instead.
 */
export function refRow(file: RefFile, base: string): { line: string; order: number | undefined } | { error: string } {
  const data = frontmatterOf(file.rel, fs.readFileSync(file.abs, "utf8"));
  const description = isString(data.description) ? data.description.trim() : "";

  if (description === "" || description.length > DESC_MAX || description.includes("\n"))
    return { error: `${file.rel}: description: missing or over ${DESC_MAX} characters` };

  const { order } = data;
  const whole = isNumber(order) && Number.isInteger(order);

  if (order !== undefined && !whole) return { error: orderError(file.rel) };

  return {
    line: `- \`${file.rel.slice(base.length + 1)}\`: ${description}`,
    order: isNumber(order) ? order : undefined,
  };
}
