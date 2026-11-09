/**
 * What `.repo/` may hold and whether it holds it right. `.repo/` is user input, so every entry must be one sync
 * reads; nothing there is silently ignored. Checked here: the layout, skills (a `SKILL.md` per folder, a matching
 * `name`, a `description`, `overrides` of a stock skill), relative links in rules and skills, that each rule `paths`
 * glob matches a file, and the budget of the always-on rule text. Rule and subagent frontmatter is checked where
 * they are loaded (`agents/sources.ts`).
 */
import fs from "node:fs";
import path from "node:path";
import { SKILL_PACKS, type SkillPack } from "../config.ts";
import { STOCK_SKILLS_REL } from "../scripts/skill-conflicts.ts";
import { scopeOf } from "./agents/rules.ts";
import { parseDoc } from "./agents/frontmatter.ts";
import type { Doc, Sources } from "./agents/sources.ts";

const REPO_DIR = ".repo";
const SKILLS_DIR = `${REPO_DIR}/skills`;
/** The cap on the bytes of all pathless rule bodies, which load into every session through `AGENTS.md`. */
export const ALWAYS_ON_BUDGET_BYTES = 12 * 1024;
const MAX_DESCRIPTION_CHARS = 1024;

const PACKAGE_DIRS = ["rules", "skills"];
const READ_DIRS = ["rules", "subagents", "skills", "lessons", "tmp", "global-settings"];
const READ_FILES = ["hooks.jsonc", "mcp-policy.jsonc", "permissions.json", "mcp.json", "map.jsonc"];
const ALLOWED = [...READ_DIRS.map((dir) => `${dir}/`), "settings/claude.json", ...READ_FILES].join(", ");
/** The entry old installs copied into `.repo/` that nothing reads; any other unknown entry gets the allowed list. */
const UNREAD = ["scripts"];
const DEAD_ENTRY = "nothing reads it; move what you need out of .repo and delete it";

export interface RepoDirInput {
  sources: Sources;
  /** The stock package root: the skills `.repo/skills` may override live under it. */
  stock: string;
  /** Every file git sees, root-relative; null outside git, which skips the `paths` check. */
  listed: readonly string[] | null;
  /** The enabled skill packs; a `.repo/skills` skill named like a stock skill of a pack that is off needs no `overrides`. */
  skills: readonly SkillPack[];
  /** Root-relative dirs of the workspace packages, whose `.repo/` holds only `rules/` and `skills/`. */
  packages: readonly string[];
}

/** One `path: problem; fix` line per fault in `<root>/.repo`, in a stable order. */
export function repoDirProblems(root: string, { sources, stock, listed, skills, packages }: RepoDirInput): string[] {
  const own = sources.rules.filter((doc) => doc.origin === "repo");
  return [
    ...layoutProblems(root),
    ...skillProblems(root, stock, skills, ""),
    ...packages.flatMap((dir) => [...packageLayoutProblems(root, dir), ...skillProblems(root, stock, skills, dir)]),
    ...own.flatMap((doc) => linkProblems(root, doc.rel, doc.body, doc.scope)),
    ...globProblems(own, listed),
    ...budgetProblems(sources.rules.filter((doc) => doc.scope === "")),
  ];
}

/** A package `.repo/` holds `rules/` and `skills/`; the root-only directories say where they live instead. */
function packageLayoutProblems(root: string, dir: string): string[] {
  return entriesOf(path.join(root, dir, REPO_DIR))
    .filter((entry) => !(entry.isDirectory() && PACKAGE_DIRS.includes(entry.name)))
    .map((entry) => {
      const dirName = entry.isDirectory();
      const where = dirName && READ_DIRS.includes(entry.name) ? `; ${entry.name} live in the root .repo` : "";
      return `${dir}/${REPO_DIR}/${entry.name}${dirName ? "/" : ""}: a package .repo holds only rules/ and skills/${where}`;
    });
}

function entriesOf(abs: string): fs.Dirent[] {
  return fs.existsSync(abs)
    ? fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))
    : [];
}

function layoutProblems(root: string): string[] {
  const problems: string[] = [];
  const dir = path.join(root, REPO_DIR);
  for (const entry of entriesOf(dir)) {
    const known = entry.isDirectory() ? READ_DIRS.includes(entry.name) : READ_FILES.includes(entry.name);
    const rel = `${REPO_DIR}/${entry.name}${entry.isDirectory() ? "/" : ""}`;
    if (entry.name === "settings" && entry.isDirectory()) {
      for (const file of entriesOf(path.join(dir, "settings"))) {
        if (file.name !== "claude.json") problems.push(`${REPO_DIR}/settings/${file.name}: ${DEAD_ENTRY}`);
      }
    } else if (UNREAD.includes(entry.name)) {
      problems.push(`${rel}: ${DEAD_ENTRY}`);
    } else if (!known) {
      problems.push(`${rel}: not part of .repo; allowed: ${ALLOWED}; explanations go in references/`);
    }
  }
  return problems;
}

/**
 * Each `.repo/skills/<name>` needs a `SKILL.md` whose `name` is the folder and whose `description` fits. One named like a
 * stock skill must say `overrides: <name>`, and an `overrides` must name a stock skill; a new name is asked for nothing more.
 * A package's skills (`scope` its dir) are namespaced by the package: they may not say `overrides` and clash with no stock name.
 */
function skillProblems(root: string, stock: string, enabled: readonly SkillPack[], scope: string): string[] {
  const problems: string[] = [];
  const stockNames = new Set(
    entriesOf(path.join(stock, STOCK_SKILLS_REL))
      .filter((e) => e.isDirectory())
      .map((e) => e.name),
  );
  const optional = new Set<string>(SKILL_PACKS.filter((pack) => !enabled.includes(pack)));
  // The stock package is this repo's own root, whose skills are not overrides of anything.
  const checkOverrides = scope === "" && path.resolve(stock) !== path.resolve(root);
  const skillsDir = scope === "" ? SKILLS_DIR : `${scope}/${SKILLS_DIR}`;
  for (const entry of entriesOf(path.join(root, skillsDir))) {
    const folder = `${skillsDir}/${entry.name}`;
    const file = `${folder}/SKILL.md`;
    if (!entry.isDirectory()) {
      problems.push(`${folder}: not a skill folder; skills are skills/<name>/SKILL.md`);
      continue;
    }
    if (!fs.existsSync(path.join(root, file))) {
      problems.push(`${folder}: SKILL.md is missing; add it or delete the folder`);
      continue;
    }
    const text = fs.readFileSync(path.join(root, file), "utf8");
    let data: Record<string, unknown>;
    try {
      data = parseDoc(file, text).data;
    } catch (error) {
      problems.push((error as Error).message);
      continue;
    }
    const { name, description, overrides } = data;
    if (name === undefined) problems.push(`${file}: name is required; set it to the folder name "${entry.name}"`);
    else if (name !== entry.name)
      problems.push(`${file}: name "${String(name)}" must equal the folder name "${entry.name}"`);
    if (typeof description !== "string" || description.trim() === "") problems.push(`${file}: description is required`);
    else if (description.length > MAX_DESCRIPTION_CHARS) {
      problems.push(
        `${file}: description is ${description.length} characters, over the ${MAX_DESCRIPTION_CHARS} limit; shorten it`,
      );
    }
    if (scope !== "" && overrides !== undefined) {
      problems.push(`${file}: overrides has no meaning in a package skill; remove it`);
    } else if (checkOverrides) {
      if (typeof overrides === "string" && !stockNames.has(overrides)) {
        problems.push(`${file}: overrides "${overrides}" but no stock skill has that name`);
      } else if (stockNames.has(entry.name) && !optional.has(entry.name) && overrides !== entry.name) {
        problems.push(
          `${folder}: a stock skill has this name; add \`overrides: ${entry.name}\` to its SKILL.md or rename it`,
        );
      }
    }
    problems.push(...linkProblems(root, file, text, path.posix.dirname(file)));
  }
  return problems;
}

const LINK = /\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;

/** One line per relative link of `text` (the file `rel`) that points at nothing, resolved from `base` under `root`. */
function linkProblems(root: string, rel: string, text: string, base: string): string[] {
  const prose = text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, "").replace(/`[^`\n]*`/g, "");
  const problems: string[] = [];
  for (const match of prose.matchAll(LINK)) {
    const target = match[1]!;
    const bare = target.split("#")[0]!;
    if (bare === "" || bare.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(bare)) continue;
    if (!fs.existsSync(path.join(root, base, bare))) problems.push(`${rel}: link ${bare} does not exist`);
  }
  return problems;
}

/**
 * A package rule's globs are relative to its dir: one starting with `../` or `/` leaves it (always refused), the rest are
 * prefixed with the dir and, with git, must match a listed file. Root rule globs are used as written.
 */
function globProblems(rules: readonly Doc[], listed: readonly string[] | null): string[] {
  const files = listed?.filter((rel) => !rel.startsWith(`${REPO_DIR}/tmp/`));
  return rules.flatMap((doc) =>
    scopeOf(doc).flatMap((glob) => {
      if (doc.scope !== "" && (glob.startsWith("../") || glob.startsWith("/"))) {
        return [`${doc.rel}: paths "${glob}" leaves the package; scope it inside ${doc.scope}`];
      }
      const full = doc.scope === "" ? glob : `${doc.scope}/${glob}`;
      return files === undefined || files.some((file) => new Bun.Glob(full).match(file))
        ? []
        : [`${doc.rel}: paths "${glob}" matches no file`];
    }),
  );
}

/** The bytes of every pathless rule body, stock included, which `AGENTS.md` holds in every session. */
function budgetProblems(rules: readonly Doc[]): string[] {
  const bytes = rules
    .filter((doc) => scopeOf(doc).length === 0)
    .reduce((sum, doc) => sum + Buffer.byteLength(doc.body.trim()), 0);
  if (bytes <= ALWAYS_ON_BUDGET_BYTES) return [];
  const kib = (value: number) => (value / 1024).toFixed(1);
  return [
    `always-on rules are ${kib(bytes)} KiB, over the ${ALWAYS_ON_BUDGET_BYTES / 1024} KiB budget; give a rule paths or make it a skill`,
  ];
}
