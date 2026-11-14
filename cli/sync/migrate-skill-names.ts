/** Renames the old stock skills `write-plan`, `write-roadmap`, `implement-plan` and `implement-roadmap` to `-deep`. */
import fs from "node:fs";
import path from "node:path";

import { REPO, STATE } from "../repo-dirs.ts";
import { byCodeUnit } from "./by-code-unit.ts";
import { isDir, present } from "./migrate-fs.ts";
import { OLD_SKILL_NAME, SKILL_RENAMES } from "./migrate-skill-names.constants.ts";
import { relativeSlash } from "./migrate-strategy-name.ts";
import { MD } from "./migrate.constants.ts";
import type { MigrationStep } from "./migrate.ts";

/** `text` with each old skill name followed by `-deep`; a rerun changes nothing. */
export function renameSkills(text: string): string {
  return text.replaceAll(OLD_SKILL_NAME, "$&-deep");
}

/** The `.md` files under `dir`, at any depth, skipping `skip` among its direct children. */
function markdownUnder(dir: string, p: typeof path, skip: string | null = null): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = p.join(dir, entry.name);

    if (entry.isDirectory()) return entry.name === skip ? [] : markdownUnder(file, p);

    return entry.isFile() && entry.name.endsWith(MD) ? [file] : [];
  });
}

/** The root-relative `.md` files under `.repo`, outside `.repo/tmp`, whose text the rename changes; sorted. */
function changed(root: string, p: typeof path): string[] {
  const dir = p.join(root, REPO);

  if (!isDir(dir)) return [];

  return markdownUnder(dir, p, STATE)
    .filter((file) => {
      const text = fs.readFileSync(file, "utf8");

      return renameSkills(text) !== text;
    })
    .map((file) => relativeSlash(root, file, p))
    .toSorted(byCodeUnit);
}

/** The move of `.repo/skills/<old>` to its new name, or a conflict when both are there; none without the old dir. */
function moveSkill(root: string, [from, to]: readonly [string, string], p: typeof path): MigrationStep[] {
  const skills = `${REPO}/skills`;

  if (!isDir(p.join(root, REPO, "skills", from))) return [];
  const step = { from: `${skills}/${from}`, to: `${skills}/${to}` };

  if (present(p.join(root, REPO, "skills", to))) return [{ ...step, kind: "conflict" }];

  return [{ ...step, kind: "move", note: `moved ${step.from} to ${step.to}` }];
}

/**
 * The steps that rename the old skills: one that renames them in every `.md` file under `.repo` but `.repo/tmp`,
 * then the move of each `.repo/skills/<old>` dir to its new name, so the moved SKILL.md already says the new name.
 * None once done.
 */
export function planSkillRename(root: string, p: typeof path = path): MigrationStep[] {
  const paths = changed(root, p);
  const count = `${paths.length} file${paths.length === 1 ? "" : "s"}`;

  const note =
    `renamed write-plan, write-roadmap, implement-plan and implement-roadmap to their -deep names in ${count} ` +
    `under ${REPO}`;

  return [
    ...(paths.length === 0 ? [] : [{ kind: "rename-text", note, paths, rename: "skills" } as const]),
    ...[...SKILL_RENAMES].flatMap((pair) => moveSkill(root, pair, p)),
  ];
}
