import path from "node:path";

import { STOCK_SKILLS_REL, listSkillDirNames } from "../scripts/skill-conflicts.ts";
import { refRow, skillRow, table, walkRefMd } from "./maps-rows.ts";
import { INDEX_REL, REFS_REL } from "./maps.constants.ts";
import { regionBody, syntaxOf } from "./region.ts";

/**
 * The bodies of the `repo:skills` and `repo:refs` sections of references/INDEX.md, from one scan of the skills
 * and references under `root`. Only this package keeps them; the hand-written text of the index is never touched.
 */
export function mapSections(root: string): { skills: string; refs: string } {
  const skills = listSkillDirNames(path.join(root, STOCK_SKILLS_REL)).map((dir) => skillRow(root, dir));
  const refs = walkRefMd(path.join(root, REFS_REL), REFS_REL, [])
    .toSorted((a, b) => a.rel.localeCompare(b.rel))
    .map(refRow);
  return {
    refs: table(["path", "title", "tags", "summary"], refs),
    skills: table(["name", "origin", "description", "task", "commandPath", "refs"], skills),
  };
}

/** The trimmed lines of the INDEX region `repo:<name>`, its markers read loosely, or null when the pair is missing. */
export function sectionBody(text: string, name: string): string[] | null {
  const body = regionBody(text, syntaxOf(INDEX_REL), name);
  if (body === undefined) return null;
  return body === "" ? [] : body.split("\n").map((l) => l.trimEnd());
}
