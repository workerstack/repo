import fs from "node:fs";
import path from "node:path";

import { STOCK_SKILLS_REL } from "../scripts/skill-conflicts.ts";
import { type ParsedDoc, parseDoc } from "./agents/frontmatter.ts";
import { entriesOf } from "./entries-of.ts";
import { linkProblems } from "./link-problems.ts";
import { MAX_DESCRIPTION_CHARS, SKILLS_DIR } from "./repo-dir.constants.ts";

/** One skills dir to check: the repo root, the stock root, the stock skills turned off, and the package dir or "". */
export type SkillCheck = { root: string; stock: string; off: readonly string[]; scope: string };

/** What every skill of one check is held to: the stock names, the names of skills that are off, and the dir. */
type SkillContext = SkillCheck & {
  stockNames: ReadonlySet<string>;
  optional: ReadonlySet<string>;
  checkOverrides: boolean;
  skillsDir: string;
};

/** One skill: its folder name, its folder and its SKILL.md, root-relative. */
type Skill = { name: string; folder: string; file: string };

function contextOf(check: SkillCheck): SkillContext {
  const { off, root, scope, stock } = check;

  const stockNames = new Set(
    entriesOf(path.join(stock, STOCK_SKILLS_REL))
      .filter((e) => e.isDirectory())
      .map((e) => e.name),
  );

  const optional = new Set<string>(off);
  // The stock package is this repo's own root, whose skills are not overrides of anything.
  const checkOverrides = scope === "" && path.resolve(stock) !== path.resolve(root);
  const skillsDir = scope === "" ? SKILLS_DIR : `${scope}/${SKILLS_DIR}`;

  return { ...check, checkOverrides, optional, skillsDir, stockNames };
}

function nameProblems({ file, name }: Skill, value: unknown): string[] {
  if (value === undefined) return [`${file}: name is required; set it to the folder name "${name}"`];

  if (value === name) return [];
  // A YAML scalar, printed as String prints it.
  const shown = value /* frontmatter values are YAML scalars here */ as string;

  return [`${file}: name "${shown}" must equal the folder name "${name}"`];
}

function descriptionProblems(file: string, description: unknown): string[] {
  if (typeof description !== "string" || description.trim() === "") return [`${file}: description is required`];

  if (description.length <= MAX_DESCRIPTION_CHARS) return [];

  return [
    `${file}: description is ${description.length} characters, over the ${MAX_DESCRIPTION_CHARS} limit; shorten it`,
  ];
}

function overridesProblems(context: SkillContext, { file, folder, name }: Skill, overrides: unknown): string[] {
  if (context.scope !== "" && overrides !== undefined)
    return [`${file}: overrides has no meaning in a package skill; remove it`];

  if (!context.checkOverrides) return [];

  if (typeof overrides === "string" && !context.stockNames.has(overrides))
    return [`${file}: overrides "${overrides}" but no stock skill has that name`];

  if (context.stockNames.has(name) && !context.optional.has(name) && overrides !== name)
    return [`${folder}: a stock skill has this name; add \`overrides: ${name}\` to its SKILL.md or rename it`];

  return [];
}

/** The problems of one entry of a skills dir: its folder and SKILL.md, its frontmatter and its links. */
function entryProblems(context: SkillContext, entry: fs.Dirent): string[] {
  const folder = `${context.skillsDir}/${entry.name}`;
  const file = `${folder}/SKILL.md`;

  if (!entry.isDirectory()) return [`${folder}: not a skill folder; skills are skills/<name>/SKILL.md`];

  if (!fs.existsSync(path.join(context.root, file)))
    return [`${folder}: SKILL.md is missing; add it or delete the folder`];
  const text = fs.readFileSync(path.join(context.root, file), "utf8");
  let data: ParsedDoc["data"];

  try {
    data = parseDoc(file, text).data;
  } catch (error) {
    return [(error /* parseDoc throws an Error naming the file */ as Error).message];
  }

  const skill = { file, folder, name: entry.name };

  return [
    ...nameProblems(skill, data["name"]),
    ...descriptionProblems(file, data["description"]),
    ...overridesProblems(context, skill, data["overrides"]),
    ...linkProblems({ base: path.posix.dirname(file), rel: file, root: context.root, text }),
  ];
}

/**
 * Each `.repo/skills/<name>` needs a `SKILL.md` whose `name` is the folder and whose `description` fits. One named
 * like a stock skill must say `overrides: <name>`, and an `overrides` must name a stock skill; a new name is asked for
 * nothing more. A package's skills (`scope` its dir) are namespaced by the package: they may not say `overrides` and
 * clash with no stock name.
 */
export function skillProblems(check: SkillCheck): string[] {
  const context = contextOf(check);

  return entriesOf(path.join(check.root, context.skillsDir)).flatMap((entry) => entryProblems(context, entry));
}
