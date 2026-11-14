/**
 * Renames the old stock skills `write-plan`, `write-roadmap`, `implement-plan` and `implement-roadmap` to `-deep`, and
 * `/do` to `/rn`.
 */
import fs from "node:fs";
import path from "node:path";

import { REPO, STATE } from "../repo-dirs.ts";
import { byCodeUnit } from "./by-code-unit.ts";
import { isDir, present } from "./migrate-fs.ts";
import { DO_SKILL_LINE, OLD_SKILL_NAME, SKILL_FILE, SKILL_RENAMES, SLASH_DO } from "./migrate-skill-names.constants.ts";
import { relativeSlash } from "./migrate-strategy-name.ts";
import { MD } from "./migrate.constants.ts";
import type { MigrationStep } from "./migrate.ts";

/**
 * `text` of the file at `rel` with each old skill name followed by `-deep` and `/do` made `/rn`; in a SKILL.md also
 * its `name: do` and `overrides: do` lines made `rn`. A rerun changes nothing.
 */
export function renameSkills(text: string, rel: string): string {
  const renamed = text.replaceAll(OLD_SKILL_NAME, "$&-deep").replaceAll(SLASH_DO, "/rn");

  return path.posix.basename(rel) === SKILL_FILE ? renamed.replaceAll(DO_SKILL_LINE, "$1: rn") : renamed;
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

      return renameSkills(text, relativeSlash(root, file, p)) !== text;
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
 * The steps that rename the old skills and `/do`: one that renames them in every `.md` file under `.repo` but
 * `.repo/tmp`, then the move of each `.repo/skills/<old>` dir to its new name, so the moved SKILL.md already says the
 * new name. None once done.
 */
export function planSkillRename(root: string, p: typeof path = path): MigrationStep[] {
  const paths = changed(root, p);
  const count = `${paths.length} file${paths.length === 1 ? "" : "s"}`;

  const note =
    "renamed write-plan, write-roadmap, implement-plan and implement-roadmap to their -deep names and /do to /rn " +
    `in ${count} under ${REPO}`;

  return [
    ...(paths.length === 0 ? [] : [{ kind: "rename-text", note, paths, rename: "skills" } as const]),
    ...[...SKILL_RENAMES].flatMap((pair) => moveSkill(root, pair, p)),
  ];
}
