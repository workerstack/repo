/**
 * What `.repo/` may hold and whether it holds it right. `.repo/` is user input, so every entry must be one sync
 * reads, or `bench/`, `lint-baseline.json` and `test-times.json`, which other commands read; nothing there is silently
 * ignored. Checked here: the layout, skills (a `SKILL.md` per folder, a matching `name`, a `description`,
 * `overrides` of a stock skill), relative links in rules and skills, that each rule `paths` glob matches a file. Rule
 * and subagent frontmatter is checked where they are loaded (`agents/load-sources.ts`).
 */
import path from "node:path";

import type { SkillPack } from "../config.ts";
import { scopeOf } from "./agents/rules.ts";
import type { Doc, Sources } from "./agents/sources.types.ts";
import { entriesOf } from "./entries-of.ts";
import { linkProblems } from "./link-problems.ts";
import {
  CLAUDE_SETTINGS_FILE,
  DEAD_ENTRY,
  OTHER_READER_DIRS,
  OTHER_READERS,
  PACKAGE_DIRS,
  READ_DIRS,
  READ_FILES,
  REPO_DIR,
  SETTINGS_DIR,
  UNREAD,
} from "./repo-dir.constants.ts";
import { skillProblems } from "./skill-problems.ts";

/** Every entry the root `.repo/` may hold, as the unknown-entry line lists them. */
function allowedList(): string {
  return [
    ...READ_DIRS.map((dir) => `${dir}/`),
    ...OTHER_READER_DIRS.map(([dir, reader]) => `${dir}/ (read by ${reader})`),
    `${SETTINGS_DIR}/${CLAUDE_SETTINGS_FILE}`,
    ...READ_FILES,
    ...OTHER_READERS.map(([file, reader]) => `${file} (read by ${reader})`),
  ].join(", ");
}
const ALLOWED = /* @__PURE__ */ allowedList();

/** Every dir the root `.repo/` may hold but settings/: the ones sync reads and the ones other commands read. */
function rootDirs(): string[] {
  return [...READ_DIRS, ...OTHER_READER_DIRS.map(([dir]) => dir)];
}

export type RepoDirInput = {
  sources: Sources;
  /** The stock package root: the skills `.repo/skills` may override live under it. */
  stock: string;
  /** Every file git sees, root-relative; null outside git, which skips the `paths` check. */
  listed: readonly string[] | null;
  /**
   * The enabled skill packs; a `.repo/skills` skill named like a stock skill of a pack that is off needs no
   * `overrides`.
   */
  skills: readonly SkillPack[];
  /** Root-relative dirs of the workspace packages, whose `.repo/` holds only `rules/` and `skills/`. */
  packages: readonly string[];
};

/** One `path: problem; fix` line per fault in `<root>/.repo`, in a stable order. */
export function repoDirProblems(root: string, { sources, stock, listed, skills, packages }: RepoDirInput): string[] {
  const own = sources.rules.filter((doc) => doc.origin === "repo");
  function skillsIn(scope: string): string[] {
    return skillProblems({ enabled: skills, root, scope, stock });
  }
  return [
    ...layoutProblems(root),
    ...skillsIn(""),
    ...packages.flatMap((dir) => [...packageLayoutProblems(root, dir), ...skillsIn(dir)]),
    ...own.flatMap((doc) => linkProblems({ base: doc.scope, rel: doc.rel, root, text: doc.body })),
    ...globProblems(own, listed),
  ];
}

/** A package `.repo/` holds `rules/` and `skills/`; the root-only directories say where they live instead. */
function packageLayoutProblems(root: string, dir: string): string[] {
  return entriesOf(path.join(root, dir, REPO_DIR))
    .filter((entry) => !(entry.isDirectory() && PACKAGE_DIRS.includes(entry.name)))
    .map((entry) => {
      const dirName = entry.isDirectory();
      const where = dirName && rootDirs().includes(entry.name) ? `; ${entry.name} live in the root .repo` : "";
      const rel = `${dir}/${REPO_DIR}/${entry.name}${dirName ? "/" : ""}`;
      return `${rel}: a package .repo holds only rules/ and skills/${where}`;
    });
}

/** Every file of `.repo/settings/` but the claude settings: nothing reads it. */
function settingsProblems(dir: string): string[] {
  return entriesOf(path.join(dir, SETTINGS_DIR))
    .filter((file) => file.name !== CLAUDE_SETTINGS_FILE)
    .map((file) => `${REPO_DIR}/${SETTINGS_DIR}/${file.name}: ${DEAD_ENTRY}`);
}

function layoutProblems(root: string): string[] {
  const problems: string[] = [];
  const dir = path.join(root, REPO_DIR);
  for (const entry of entriesOf(dir)) {
    const known = entry.isDirectory()
      ? rootDirs().includes(entry.name)
      : [...READ_FILES, ...OTHER_READERS.map(([file]) => file)].includes(entry.name);
    const rel = `${REPO_DIR}/${entry.name}${entry.isDirectory() ? "/" : ""}`;
    if (entry.name === SETTINGS_DIR && entry.isDirectory()) problems.push(...settingsProblems(dir));
    else if (UNREAD.includes(entry.name)) problems.push(`${rel}: ${DEAD_ENTRY}`);
    else if (!known) problems.push(`${rel}: not part of .repo; allowed: ${ALLOWED}; explanations go in references/`);
  }
  return problems;
}

/**
 * A package rule's globs are relative to its dir: one starting with `../` or `/` leaves it (always refused), the rest
 * are prefixed with the dir and, with git, must match a listed file. Root rule globs are used as written.
 */
function globProblems(rules: readonly Doc[], listed: readonly string[] | null): string[] {
  const files = listed?.filter((rel) => !rel.startsWith(`${REPO_DIR}/tmp/`));
  return rules.flatMap((doc) =>
    scopeOf(doc).flatMap((glob) => {
      if (doc.scope !== "" && (glob.startsWith("../") || glob.startsWith("/")))
        return [`${doc.rel}: paths "${glob}" leaves the package; scope it inside ${doc.scope}`];

      const full = doc.scope === "" ? glob : `${doc.scope}/${glob}`;
      return files === undefined || files.some((file) => new Bun.Glob(full).match(file))
        ? []
        : [`${doc.rel}: paths "${glob}" matches no file`];
    }),
  );
}
