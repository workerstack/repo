import path from "node:path";
import { STOCK_SKILLS_REL, listSkillDirNames } from "../scripts/skill-conflicts.ts";
import { lines } from "../scripts/managed-text.ts";
import { NOT_FOUND, REFS_REL } from "./maps.constants.ts";
import { refRow, skillRow, table, walkRefMd } from "./maps-rows.ts";

/**
 * The bodies of the `repo:skills` and `repo:refs` sections of references/INDEX.md, from one scan of the skills
 * and references under `root`. Only this package keeps them; the hand-written text of the index is never touched.
 */
export function mapSections(root: string): { skills: string; refs: string } {
  const skills = listSkillDirNames(path.join(root, STOCK_SKILLS_REL)).map((dir) => skillRow(root, dir));
  const refs = walkRefMd(path.join(root, REFS_REL), REFS_REL, [])
    .sort((a, b) => a.rel.localeCompare(b.rel))
    .map(refRow);
  return {
    skills: table(["name", "origin", "description", "task", "commandPath", "refs"], skills),
    refs: table(["path", "title", "tags", "summary"], refs),
  };
}

/** The lines between `<!-- repo:<name> -->` and `<!-- /repo:<name> -->`, or null when the pair is missing. */
export function sectionBody(text: string, name: string): string[] | null {
  const all = lines(text);
  const start = all.findIndex((l) => l.trimEnd() === `<!-- repo:${name} -->`);
  if (start === NOT_FOUND) return null;
  const stop = all.findIndex((l, at) => at > start && l.trimEnd() === `<!-- /repo:${name} -->`);
  return stop === NOT_FOUND ? null : all.slice(start + 1, stop).map((l) => l.trimEnd());
}
