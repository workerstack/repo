import path from "node:path";

import { extraH2Sections } from "./agents-text.ts";
import { filesUnder, isDir, present, stockRel } from "./migrate-fs.ts";
import { SKILL_RENAMES } from "./migrate-skill-names.constants.ts";
import { renameSkills } from "./migrate-skill-names.ts";
import { COPIED_DIR, MD, REPO_DIR, RULE_FRONTMATTER } from "./migrate.constants.ts";
import type { MoveMark } from "./migrate.ts";
import type { MigrationState } from "./migration-state.ts";

const H2 = "## ";

/** The first `# ` heading line. */
const H1_LINE = /^# .+$/m;

/** Every `## ` heading line; for `matchAll`. */
const H2_LINES = /^## .+$/gm;

/** The `.md` ending of a file name. */
const MD_END = /\.md$/;

/** The first `# ` heading line of a markdown text, or null. */
export function h1Of(text: string): string | null {
  return H1_LINE.exec(text)?.[0].trimEnd() ?? null;
}

/** `"A", "B"`: the titles of the `## ` sections in `sections`. */
export function titlesOf(sections: string): string {
  return [...sections.matchAll(H2_LINES)].map(([line]) => `"${line.slice(H2.length).trim()}"`).join(", ");
}

/**
 * A rule of the copied dir: one the stock lacks moves over, a stock one's own `##` sections go to a `-local`
 * sibling.
 */
function planRule(state: MigrationState, name: string): void {
  const from = `${COPIED_DIR}/rules/${name}`;
  const stockText = state.stockText(from);
  const own = isDir(path.join(state.root, from)) ? null : state.text(from);

  if (own !== null && state.unedited(from, own, stockText)) return;
  const to = `${REPO_DIR}/rules/${name}`;

  if (own === null || stockText === null) {
    state.move(from, to, { note: `moved ${from} to ${to}` });

    return;
  }

  const extras = extraH2Sections(own, stockText);
  const base = name.replace(MD_END, "");

  if (extras === "") {
    const mark = state.mark(from, to, { kind: "rule", name: base });
    state.move(from, to, { mark, note: `moved your edited ${from} to ${to} (it now replaces the stock rule)` });

    return;
  }

  const heading = h1Of(stockText);
  const local = `${REPO_DIR}/rules/${base}-local${MD}`;
  const content = `${RULE_FRONTMATTER}${heading === null ? "" : `${heading}\n\n`}${extras}\n`;
  state.write(from, local, { content, note: `moved your sections ${titlesOf(extras)} of ${from} to ${local}` });
}

/** Rules the stock lacks move over; a stock rule's own `##` sections go to a `-local` sibling, so stock stays live. */
export function planRules(state: MigrationState): void {
  for (const name of state.names(`${COPIED_DIR}/rules`)) planRule(state, name);
}

/** Subagents the stock lacks move over; an edited stock subagent moves whole and overrides stock. */
export function planSubagents(state: MigrationState): void {
  for (const name of state.names(`${COPIED_DIR}/subagents`)) {
    const from = `${COPIED_DIR}/subagents/${name}`;
    const stockText = state.stockText(from);
    const isFolder = isDir(path.join(state.root, from));

    if (!isFolder && state.unedited(from, state.text(from), stockText)) continue;
    const to = `${REPO_DIR}/subagents/${name}`;

    if (stockText === null || isFolder) {
      state.move(from, to, { note: `moved ${from} to ${to}` });
    } else {
      const mark = state.mark(from, to, { kind: "subagent", name: name.replace(MD_END, "") });
      state.move(from, to, { mark, note: `moved your edited ${from} to ${to} (it now replaces the stock subagent)` });
    }
  }
}

/** Whether a skill dir holds a file that is no stock version, so it is the consumer's. */
export function editedSkill(state: MigrationState, from: string): boolean {
  return filesUnder(path.join(state.root, from)).some((file) => {
    const rel = `${from}/${file}`;

    return !state.unedited(rel, state.text(rel), state.stockText(rel));
  });
}

/**
 * The mark of a copied skill that took a new name: `mark`, or the SKILL.md as it is, with the old skill names renamed,
 * so the moved file already says its new name; `mark` when the rename changes nothing.
 */
function renamedMark(
  state: MigrationState,
  file: { from: string; to: string },
  mark: MoveMark | undefined,
): MoveMark | undefined {
  const text = mark?.content ?? state.read(file.from);

  if (text === null) return mark;
  const content = renameSkills(text);

  if (content === text) return mark;

  return { content, note: mark?.note ?? `renamed the old skill names in ${file.to}`, path: file.from };
}

/**
 * Skill dirs the stock lacks or the consumer edited move to `.repo/skills`, an old stock skill under its new name; the
 * rest are stock copies to remove.
 */
export function planSkills(state: MigrationState): void {
  for (const name of state.names(".agents/skills")) {
    const from = `.agents/skills/${name}`;

    if (!isDir(path.join(state.root, from))) continue;
    const target = SKILL_RENAMES.get(name) ?? name;
    const to = `${REPO_DIR}/skills/${target}`;
    const file = { from: `${from}/SKILL.md`, to: `${to}/SKILL.md` };

    if (!editedSkill(state, from)) {
      state.drop.push(from);
    } else if (present(path.join(state.stock, stockRel(`.agents/skills/${target}`)))) {
      const marked = state.mark(file.from, file.to, { kind: "skill", name: target });
      const mark = target === name ? marked : renamedMark(state, file, marked);
      state.move(from, to, { mark, note: `moved your edited ${from} to ${to} (it now replaces the stock skill)` });
    } else {
      const mark = target === name ? undefined : renamedMark(state, file, undefined);
      state.move(from, to, { mark, note: `moved ${from} to ${to}` });
    }
  }
}
